// Wilson name formatter — cleans up customer name entry on the payment tools:
//   "pollinger, lynn"  -> "Lynn Pollinger"   (Last, First flipped)
//   "LYNN POLLINGER"   -> "Lynn Pollinger"   (casing corrected)
//   "o'brien-smith jr" -> "O'Brien-Smith Jr"
// When it corrects something, a small notice appears under the field so the
// team learns the convention: First Last, properly capitalized.
//
// Auto-attaches to #customerName and anything with [data-name-format].
// Also exposed as window.WilsonNameFormat = { attach, formatName }.
(function () {
  const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  const ROMAN = new Set(["ii", "iii", "iv", "v"]);
  // Lowercase name particles when not the first word: "Ana de la Cruz".
  const PARTICLES = new Set(["van", "von", "de", "der", "den", "del", "della", "di", "da", "la", "le"]);

  function caseWord(word, isFirstToken) {
    if (!word) return word;
    const lower = word.toLowerCase();
    const bare = lower.replace(/\./g, "");

    if (SUFFIXES.has(bare)) {
      if (ROMAN.has(bare)) return bare.toUpperCase();
      return bare.charAt(0).toUpperCase() + bare.slice(1) + (word.includes(".") ? "." : "");
    }
    if (!isFirstToken && PARTICLES.has(lower)) return lower;

    // Capitalize the start and after hyphens/apostrophes:
    // "smith-jones" -> "Smith-Jones", "o'brien" -> "O'Brien"
    let out = lower.replace(/(^|[-'’])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
    // "mcdonald" -> "McDonald" (Mac left alone on purpose — "Macey", "Mack")
    out = out.replace(/^Mc([a-z])/, (m, ch) => "Mc" + ch.toUpperCase());
    return out;
  }

  function formatName(raw) {
    let value = String(raw || "").replace(/\s+/g, " ").trim();
    if (!value) return { value: "", changed: false, swapped: false };

    let swapped = false;
    // "Last, First [Middle]" -> "First [Middle] Last". Only when there is
    // exactly one comma with text on both sides — anything else is unusual
    // enough that we leave it alone rather than guess.
    const commaParts = value.split(",");
    if (commaParts.length === 2 && commaParts[0].trim() && commaParts[1].trim()) {
      value = (commaParts[1].trim() + " " + commaParts[0].trim()).replace(/\s+/g, " ");
      swapped = true;
    }

    const cased = value
      .split(" ")
      .map((word, index) => caseWord(word, index === 0))
      .join(" ");

    return {
      value: cased,
      changed: swapped || cased !== String(raw || "").trim(),
      swapped
    };
  }

  function attach(input) {
    if (!input || input.dataset.nameFormatBound === "true") return;
    input.dataset.nameFormatBound = "true";

    const note = document.createElement("div");
    note.style.cssText =
      "display:none;margin-top:6px;padding:8px 12px;border-radius:10px;" +
      "background:#fffbeb;color:#92400e;border:1px solid #fde68a;" +
      "font-size:12.5px;line-height:1.5;";
    input.insertAdjacentElement("afterend", note);
    let hideTimer = null;

    input.addEventListener("change", () => {
      const original = input.value;
      const result = formatName(original);

      if (!result.value || result.value === original) {
        note.style.display = "none";
        return;
      }

      input.value = result.value;
      note.textContent = result.swapped
        ? "Reformatted to “" + result.value + "” — enter names as First Last (not Last, First), properly capitalized."
        : "Reformatted to “" + result.value + "” — names should be First Last, properly capitalized.";
      note.style.display = "block";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { note.style.display = "none"; }, 8000);
    });
  }

  function attachAll() {
    document.querySelectorAll("#customerName, [data-name-format]").forEach(attach);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachAll);
  } else {
    attachAll();
  }

  window.WilsonNameFormat = { attach, formatName };
})();
