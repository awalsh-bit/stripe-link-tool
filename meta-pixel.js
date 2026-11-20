// ---------------------------------------------------------------------------
// Meta Pixel on the shop (Andrew 11/20). Dataset "Wilson AC & Appliance data",
// 1962893141241918, the one wilsonappliance.com already reports to. Meta's
// own GTM connector only lists Tag Manager containers you were added to
// directly, and the shop's container (GTM-KCPSFXV7) comes through Google Ads,
// so the pixel is here, in one file, on the same four pages as the Google
// tag: shop-home.html, shop.html, every product page and /about.
//
// Like the Google tag it runs only on shop.wilsonappliance.com: local copies
// and test servers never report. Meta's <noscript> image is left out
// because it can't check the address.
//
// The shop's own Google ecommerce steps are passed on as Meta's standard
// events (wilsonMeta.track(event, ecommerce), called next to each
// dataLayer push):
//   view_item -> ViewContent     add_to_cart -> AddToCart
//   begin_checkout -> InitiateCheckout     purchase -> Purchase
//   generate_lead -> Lead
// Model numbers, prices and order totals only - never a name, phone, email,
// address or client code. See docs/shop/meta-pixel.md.
// ---------------------------------------------------------------------------
(function () {
  var PIXEL_ID = "1962893141241918";
  var LIVE = location.hostname === "shop.wilsonappliance.com";
  var api = { live: LIVE, track: function () {} };
  window.wilsonMeta = api;
  if (!LIVE) return;

  /* Meta Pixel Code (Meta's base code, as given) */
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');
  /* End Meta Pixel Code */

  var NAMES = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase", generate_lead: "Lead" };
  var money = function (v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
  api.track = function (event, ecommerce) {
    try {
      var name = NAMES[event];
      if (!name || typeof window.fbq !== "function") return;
      var ec = ecommerce || {};
      var params = { currency: ec.currency || "USD" };
      if (name !== "Lead") {
        // the appliances themselves; installation and parts lines ride along in the value
        var items = (Array.isArray(ec.items) ? ec.items : []).filter(function (i) { return i && i.item_id && !/^(Installation|Parts)$/.test(i.item_category || ""); });
        params.content_type = "product";
        params.content_ids = items.map(function (i) { return String(i.item_id); });
        params.contents = items.map(function (i) { var c = { id: String(i.item_id), quantity: Number(i.quantity) || 1 }; var p = money(i.price); if (p) c.item_price = p; return c; });
        if (items.length === 1 && items[0].item_name) params.content_name = String(items[0].item_name);
        if (name === "InitiateCheckout" || name === "Purchase") params.num_items = params.contents.reduce(function (a, c) { return a + c.quantity; }, 0);
      }
      var value = money(ec.value);
      if (value) params.value = value;
      // the order number, so a reload or a later server-side event is counted once
      if (name === "Purchase" && ec.transaction_id) window.fbq("track", name, params, { eventID: "order-" + String(ec.transaction_id) });
      else window.fbq("track", name, params);
    } catch (err) {}
  };
})();
