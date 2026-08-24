from __future__ import annotations

import contextlib
from email import policy
from email.parser import BytesParser
import http.server
import json
import os
from pathlib import Path
import socket
import sys
import threading
import traceback
import urllib.parse
import webbrowser

from invoice_parser import parse_invoice_files

BIND_HOST = "0.0.0.0"
BROWSER_HOST = "127.0.0.1"
START_PORT = 8080
END_PORT = 8090
ROOT = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 30 * 1024 * 1024


class WilsonPortalHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".md": "text/markdown",
        ".sql": "text/plain",
        ".svg": "image/svg+xml",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        sys.stdout.write("%s - %s\n" % (self.log_date_time_string(), format % args))

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urllib.parse.urlparse(self.path).path
        if path != "/api/invoice/import":
            self._send_json(404, {"ok": False, "error": "Unknown API endpoint."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0") or 0)
            if content_length <= 0:
                self._send_json(400, {"ok": False, "error": "No invoice files were received."})
                return
            if content_length > MAX_UPLOAD_BYTES:
                self._send_json(413, {"ok": False, "error": "The combined upload is larger than 30 MB."})
                return

            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data"):
                self._send_json(415, {"ok": False, "error": "Upload PDF invoices using multipart form data."})
                return

            raw_body = self.rfile.read(content_length)
            mime = (
                f"Content-Type: {content_type}\r\n"
                "MIME-Version: 1.0\r\n\r\n"
            ).encode("utf-8") + raw_body
            message = BytesParser(policy=policy.default).parsebytes(mime)

            files: list[tuple[str, bytes]] = []
            for part in message.iter_parts():
                filename = part.get_filename()
                if not filename:
                    continue
                payload = part.get_payload(decode=True) or b""
                if not payload:
                    continue
                if not filename.lower().endswith(".pdf"):
                    continue
                files.append((Path(filename).name, payload))

            if not files:
                self._send_json(400, {"ok": False, "error": "No PDF invoice files were found in the upload."})
                return

            result = parse_invoice_files(files)
            self._send_json(200, result)
        except Exception as exc:  # pragma: no cover - surfaced to prototype UI
            traceback.print_exc()
            self._send_json(500, {"ok": False, "error": f"Invoice parsing failed: {exc}"})


def port_is_available(port: int) -> bool:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((BIND_HOST, port))
        except OSError:
            return False
        return True


def choose_port() -> int:
    for port in range(START_PORT, END_PORT + 1):
        if port_is_available(port):
            return port
    raise RuntimeError(f"No open port was found between {START_PORT} and {END_PORT}.")


def local_network_ip() -> str:
    """Best-effort LAN IPv4 for opening the prototype from a phone on the same network."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "YOUR-PC-IP"
    finally:
        sock.close()


def main() -> int:
    os.chdir(ROOT)
    try:
        port = choose_port()
    except RuntimeError as exc:
        print(f"\nERROR: {exc}")
        input("Press Enter to close...")
        return 1

    server = http.server.ThreadingHTTPServer((BIND_HOST, port), WilsonPortalHandler)
    url = f"http://{BROWSER_HOST}:{port}/index.html"
    phone_url = f"http://{local_network_ip()}:{port}/index.html"

    print("\nWilson Maintenance Portal prototype v0.9")
    print("-----------------------------------------")
    print(f"Computer: {url}")
    print(f"Phone (same Wi-Fi/LAN): {phone_url}")
    print("If Windows Firewall prompts for Python, allow Private networks only.")
    print("PDF sales-invoice import is available in Maintenance Operations.")
    print("Keep this window open while using the prototype.")
    print("Press Ctrl+C here when you are finished.\n")

    threading.Timer(0.8, lambda: webbrowser.open(url, new=1)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Wilson Maintenance Portal...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
