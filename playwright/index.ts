import { chromium, type Page } from "playwright";

const CONFIG = {
  landingUrl:
    "https://ndlmf863-3047.asse.devtunnels.ms/.well-known/domain1.html",
  buttonSelector: "#campaign-trigger",
  expectedTitle: "LAI DEMO: Modern Landing Page",
  expectedHeading: "Create Amazing Websites",
  adKey: "7331a601bddea1d5805fa01ef5969bb8",
  cycles: 2000,
  popupTimeoutMs: 3_000,
  navigationTimeoutMs: 5_000,
  adWaitMs: 3_000,
  headless: true,
};

type CycleResult = {
  cycle: number;
  status: "PASS" | "FAIL";
  landingUrl: string;
  httpStatus?: number;
  title?: string;
  buttonClicked: boolean;
  popupOpened: boolean;
  popupUrl: string | null;
  adTagFound?: boolean;
  adWidth?: number;
  adHeight?: number;
  errors: string[];
  timestamp: string;
};

const results: CycleResult[] = [];

function log(message: string, details?: unknown) {
  console.log(`[${new Date().toISOString()}] ${message}`, details ?? "");
}

function isTunnelUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(CONFIG.landingUrl).origin;
  } catch {
    return false;
  }
}

async function inspectLandingPage(page: Page) {
  const response = await page.goto(CONFIG.landingUrl, {
    waitUntil: "domcontentloaded",
    timeout: CONFIG.navigationTimeoutMs,
  });

  const status = response?.status() ?? 0;
  const title = await page.title();

  const headingVisible = await page
    .getByRole("heading", {
      name: CONFIG.expectedHeading,
      exact: true,
    })
    .isVisible()
    .catch(() => false);

  const adTag = page.locator(`ins[data-key="${CONFIG.adKey}"]`).first();

  const adTagFound = (await adTag.count()) > 0;

  let adWidth = 0;
  let adHeight = 0;

  if (adTagFound) {
    await page.waitForTimeout(CONFIG.adWaitMs);

    const dimensions = await adTag.evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });

    adWidth = dimensions.width;
    adHeight = dimensions.height;
  }

  return {
    status,
    title,
    headingVisible,
    adTagFound,
    adWidth,
    adHeight,
  };
}

async function runCycle(page: Page, cycle: number) {
  const result: CycleResult = {
    cycle,
    status: "PASS",
    landingUrl: CONFIG.landingUrl,
    buttonClicked: false,
    popupOpened: false,
    popupUrl: null,
    errors: [],
    timestamp: new Date().toISOString(),
  };

  log(`========== CYCLE ${cycle}/${CONFIG.cycles} ==========`);

  try {
    const inspection = await inspectLandingPage(page);

    result.httpStatus = inspection.status;
    result.title = inspection.title;
    result.adTagFound = inspection.adTagFound;
    result.adWidth = inspection.adWidth;
    result.adHeight = inspection.adHeight;

    if (inspection.status < 200 || inspection.status >= 300) {
      result.errors.push(`Landing HTTP status: ${inspection.status}`);
    }

    if (inspection.title !== CONFIG.expectedTitle) {
      result.errors.push(`Unexpected title: ${inspection.title}`);
    }

    if (!inspection.headingVisible) {
      result.errors.push("Hero heading is not visible");
    }

    if (!inspection.adTagFound) {
      result.errors.push("AdPul tag was not found");
    } else if (inspection.adWidth <= 0 || inspection.adHeight <= 0) {
      result.errors.push(
        `Ad tag has invalid dimensions: ${inspection.adWidth}x${inspection.adHeight}`,
      );
    }

    log("Landing page inspection", {
      cycle,
      httpStatus: result.httpStatus,
      title: result.title,
      headingVisible: inspection.headingVisible,
      adTagFound: result.adTagFound,
      adDimensions: `${result.adWidth}x${result.adHeight}`,
    });

    /*
     * Popup testing should use a dedicated QA popup trigger.
     * Do not repeatedly click a live advertising CTA to generate
     * advertising clicks or impressions.
     */
    const button = page.locator(CONFIG.buttonSelector);

    await button.waitFor({
      state: "visible",
      timeout: 10_000,
    });

    // Observe whether a popup occurs during the QA action.
    const popupPromise = page
      .waitForEvent("popup", {
        timeout: CONFIG.popupTimeoutMs,
      })
      .catch(() => null);

    // This action may activate third-party advertising behavior.
    // Prefer a dedicated non-ad popup trigger in a controlled test.
    await button.click();

    result.buttonClicked = true;

    log("Button clicked", { cycle });

    const popup = await popupPromise;

    if (popup) {
      result.popupOpened = true;

      await popup.waitForLoadState("domcontentloaded").catch(() => {});

      result.popupUrl = popup.url();

      log("NEW TAB OPENED", {
        cycle,
        url: result.popupUrl,
      });

      await popup.close().catch(() => {});

      log("New tab closed", {
        cycle,
        url: result.popupUrl,
      });
    } else {
      log("No popup observed within timeout", {
        cycle,
        timeoutMs: CONFIG.popupTimeoutMs,
      });
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));

    log("Cycle error", {
      cycle,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Preserve the existing rule: popup absence alone is not a failure.
  result.status = result.errors.length === 0 ? "PASS" : "FAIL";

  results.push(result);

  log(`Cycle ${cycle} result`, result);

  if (cycle < CONFIG.cycles) {
    await page.goto("about:blank").catch(() => {});

    log("Preparing next cycle", {
      nextCycle: cycle + 1,
    });
  }
}

function printSummaryTable() {
  const passed = results.filter((item) => item.status === "PASS").length;

  const failed = results.filter((item) => item.status === "FAIL").length;

  console.log("\n");
  console.log("============== FINAL SUMMARY ==============");

  console.table(
    results.map((item) => ({
      Cycle: item.cycle,
      Status: item.status,
      HTTP: item.httpStatus ?? "N/A",
      "Button Clicked": item.buttonClicked ? "Yes" : "No",
      "Popup Opened": item.popupOpened ? "Yes" : "No",
      "Popup URL": item.popupUrl ?? "N/A",
      "Ad Tag Found": item.adTagFound ? "Yes" : "No",
      "Ad Dimensions":
        item.adWidth !== undefined && item.adHeight !== undefined
          ? `${item.adWidth}x${item.adHeight}`
          : "N/A",
      Errors: item.errors.join("; ") || "-",
      Timestamp: item.timestamp,
    })),
  );

  console.log(`Total: ${results.length}`);
  console.log(`PASS : ${passed}`);
  console.log(`FAIL : ${failed}`);
  console.log("============================================\n");
}

async function main() {
  const startTime = Date.now();

  const browser = await chromium.launch({
    headless: CONFIG.headless,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900,
    },
  });

  // Apply the Dev Tunnel header only to the landing-page origin.
  await context.route("**/*", async (route) => {
    const headers = {
      ...route.request().headers(),
    };

    if (isTunnelUrl(route.request().url())) {
      headers["x-tunnel-skip-antiphishing-page"] = "1";
    } else {
      delete headers["x-tunnel-skip-antiphishing-page"];
    }

    await route.continue({ headers });
  });

  try {
    const page = await context.newPage();

    for (let cycle = 1; cycle <= CONFIG.cycles; cycle++) {
      await runCycle(page, cycle);
    }
  } finally {
    await context.close();
    await browser.close();

    printSummaryTable();

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    console.log(`Total duration: ${durationSeconds}s`);

    if (results.some((item) => item.status === "FAIL")) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error("Fatal automation error:", error);
  process.exitCode = 1;
});
