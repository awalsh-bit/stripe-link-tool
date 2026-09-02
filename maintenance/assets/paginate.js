(function () {
  /*
   * FLOWING LONG SECTIONS ACROSS SHEETS.
   *
   * THE BUG THIS EXISTS TO FIX
   * --------------------------
   * `.report-page` is a fixed sheet: `max-height: 11in; overflow: hidden` in
   * print. That is what makes the reports look like documents rather than a
   * scrolling web page, and for the per-appliance report -- where every section
   * has bounded content -- it is fine.
   *
   * The compiled visit review does not have bounded content. A stop has as many
   * findings as it has, and an estate has as many appliances as it has. On
   * screen the section simply grew and everything was visible. On paper the
   * sheet was capped and the overflow was DISCARDED, silently:
   *
   *   - the Portfolio Summary printed 3 of 5 findings
   *   - the Appliance Inventory printed 10 of 16 appliances, ending mid-heading
   *
   * A maintenance review that drops findings on the way to the printer is worse
   * than no review, because nobody can tell it happened. The screen version
   * looked complete, which is exactly why it survived until someone generated
   * an actual PDF and counted.
   *
   * HOW IT WORKS
   * ------------
   * A section marks its repeatable region with `data-flow`. After render, each
   * such section is measured against the real sheet height, and its blocks are
   * distributed across as many continuation sheets as they need -- each one a
   * proper `.report-page` with the same header and footer, so a continuation
   * sheet is indistinguishable from an original.
   *
   * Measurement is done from the live DOM rather than estimated from font
   * metrics: a guess at how tall a finding "should be" is how you get an
   * off-by-one that only shows up on the one report that matters.
   */

  /* The sheet is 11in tall and 1110px on screen; everything is measured in
     screen pixels and this is the conversion the stylesheet already implies. */
  const SHEET_PX = 1110;

  function heightOf(el) {
    const style = window.getComputedStyle(el);
    return el.offsetHeight
      + parseFloat(style.marginTop || 0)
      + parseFloat(style.marginBottom || 0);
  }

  /*
   * How much room a sheet's body actually has.
   *
   * Derived from the rendered header, footer and body padding rather than
   * hardcoded, so a change to any of those cannot silently start truncating
   * again.
   */
  function bodyBudget(page) {
    const header = page.querySelector(".report-page-header");
    const footer = page.querySelector(".report-page-footer");
    const body = page.querySelector(".report-page-body");
    if (!body) return 0;
    const style = window.getComputedStyle(body);
    const chrome = (header ? header.offsetHeight : 0)
      + (footer ? footer.offsetHeight : 0)
      + parseFloat(style.paddingTop || 0)
      + parseFloat(style.paddingBottom || 0);
    /* A few pixels of slack: sub-pixel rounding between the screen box model
       and the print box model should never be the thing that clips a line. */
    return SHEET_PX - chrome - 6;
  }

  function newSheet(template, titleSuffix) {
    const clone = template.cloneNode(true);
    const body = clone.querySelector(".report-page-body");
    if (body) body.innerHTML = "";
    const heading = clone.querySelector(".report-page-header h2");
    if (heading && titleSuffix && heading.textContent.indexOf(titleSuffix) === -1) {
      heading.textContent = heading.textContent + titleSuffix;
    }
    return clone;
  }

  /*
   * Split one section into as many sheets as its content needs.
   *
   * Everything before the `[data-flow]` container is fixed furniture (the lead
   * paragraph, the status bands, the mean) and stays on the first sheet. The
   * flow container's children are the blocks that move.
   */
  function flowSection(page) {
    const body = page.querySelector(".report-page-body");
    const flow = body && body.querySelector("[data-flow]");
    if (!body || !flow) return [page];

    const budget = bodyBudget(page);
    if (budget <= 0) return [page];

    const blocks = Array.prototype.slice.call(flow.children);
    if (!blocks.length) return [page];

    /*
     * MEASURE THE FLOW CONTAINER, AFTER EACH BLOCK.
     *
     * Two wrong measurements were tried first, and both are instructive.
     *
     * 1. Summing each block's own height. Right for a stacked list, badly wrong
     *    for anything laid out side by side: the photograph grid puts five cells
     *    per row, so five cell heights read as five rows and the budget was
     *    spent after one photograph.
     *
     * 2. Reading `scrollHeight` of the sheet body. Useless here, because
     *    `.report-page-body` is `flex: 1` inside a `min-height: 1110px` sheet --
     *    it is STRETCHED to fill the page, so its scrollHeight is ~927px whether
     *    it holds one photograph or twenty. Fourteen photographs produced
     *    fourteen sheets, each reporting itself as overflowing.
     *
     * What works is asking the flow container for its own height after each
     * block is appended. A grid reports one row, then two, then three; a
     * stacked list reports the running total; anything else reports whatever it
     * actually does. The fixed furniture around it is measured once.
     */
    blocks.forEach(function (block) { flow.removeChild(block); });

    /* Fixed furniture on the FIRST sheet only -- continuation sheets carry just
       the flow container, so their whole budget is available to blocks. */
    let fixed = 0;
    Array.prototype.forEach.call(body.children, function (child) {
      if (child !== flow) fixed += heightOf(child);
    });
    /*
     * The flow container's OWN margins. heightOf(currentFlow) below measures
     * the container's box, not the gap above and below it -- and that gap was
     * ~30px of unaccounted height. For a year it hid inside the slack, until
     * v0.9.39's longer check names put the Inspection Details sheet within
     * 26px of the edge and the QA overflow check caught what this arithmetic
     * was quietly ignoring.
     */
    const flowStyle = window.getComputedStyle(flow);
    const flowMargins = parseFloat(flowStyle.marginTop || 0) + parseFloat(flowStyle.marginBottom || 0);
    fixed += flowMargins;

    const pages = [];
    let current = page;
    let currentFlow = flow;
    let overhead = fixed;
    let placedOnThisSheet = 0;

    blocks.forEach(function (block) {
      currentFlow.appendChild(block);

      /* Always keep at least one block per sheet: a block taller than a whole
         sheet cannot be helped by moving it, and an empty continuation sheet
         followed by the same block is an infinite loop. */
      if (placedOnThisSheet > 0 && overhead + heightOf(currentFlow) > budget) {
        currentFlow.removeChild(block);
        pages.push(current);

        current = newSheet(page, " (continued)");
        const newBody = current.querySelector(".report-page-body");
        const shell = flow.cloneNode(false);
        newBody.appendChild(shell);
        /* In the document before it is measured, or its grid has no width. */
        pages[pages.length - 1].insertAdjacentElement("afterend", current);
        currentFlow = shell;
        /* A continuation sheet still pays the flow container's margins. */
        overhead = flowMargins;
        placedOnThisSheet = 0;
        currentFlow.appendChild(block);
      }

      placedOnThisSheet += 1;
    });

    pages.push(current);
    return pages;
  }

  /*
   * Run over a rendered sheet. Safe to call when nothing needs splitting.
   * Returns the number of continuation sheets that had to be added, which the
   * QA suite asserts against the number of blocks.
   */
  function run(host) {
    if (!host) return 0;
    const sections = Array.prototype.slice.call(host.querySelectorAll(".report-page"));
    let added = 0;

    sections.forEach(function (page) {
      if (!page.querySelector("[data-flow]")) return;
      const produced = flowSection(page);
      /* flowSection inserts each continuation sheet as it creates it, because a
         sheet has to be in the document to be measured while it is filled. */
      added += Math.max(0, produced.length - 1);
    });

    return added;
  }

  window.WILSON_PAGINATE = { run: run, sheetPx: SHEET_PX };
})();
