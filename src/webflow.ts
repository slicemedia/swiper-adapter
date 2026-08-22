import { A11y, Navigation, Pagination } from "swiper/modules";
import type { SwiperOptions } from "swiper/types";

export type WebflowSwiperModule = NonNullable<SwiperOptions["modules"]>[number];
export type WebflowSwiperA11yOptions = Exclude<SwiperOptions["a11y"], boolean | undefined>;
export type WebflowSwiperElementReference = string | HTMLElement;

export interface WebflowSwiperNavigationOptions {
  next?: WebflowSwiperElementReference;
  nextLabel?: string;
  previous?: WebflowSwiperElementReference;
  previousLabel?: string;
}

export interface WebflowSwiperPaginationOptions {
  clickable?: boolean;
  element?: WebflowSwiperElementReference;
}

export interface WebflowSwiperIntegrationOptions {
  a11y?: false | WebflowSwiperA11yOptions;
  modules?: readonly WebflowSwiperModule[];
  navigation?: false | WebflowSwiperNavigationOptions;
  pagination?: false | WebflowSwiperPaginationOptions;
  swiper?: SwiperOptions;
}

interface ResolvedNavigation {
  nextLabel: string;
  options: { nextEl: HTMLButtonElement; prevEl: HTMLButtonElement };
  previousLabel: string;
}

const defaultPreviousSelector = "[data-wft-slider-prev]";
const defaultNextSelector = "[data-wft-slider-next]";
const defaultPaginationSelector = "[data-wft-slider-pagination]";

/**
 * Build scoped Swiper options for standard Webflow-authored markup.
 *
 * The helper is opt-in: it imports upstream modules but no CSS, creates no controls,
 * and performs no initialization. Navigation controls must be native buttons with
 * an existing accessible name or an explicit localized label in this configuration.
 */
export function createWebflowSwiperOptions(
  root: HTMLElement,
  integration: WebflowSwiperIntegrationOptions = {},
): SwiperOptions {
  const swiperOptions = { ...(integration.swiper ?? {}) };
  const configuredModules = swiperOptions.modules ?? [];
  const configuredA11y = swiperOptions.a11y;
  delete swiperOptions.modules;
  delete swiperOptions.a11y;
  delete swiperOptions.navigation;
  delete swiperOptions.pagination;

  const navigation = resolveNavigation(root, integration.navigation);
  const pagination = resolvePagination(root, integration.pagination);
  const a11y =
    integration.a11y === false
      ? false
      : {
          ...(navigation
            ? {
                nextSlideMessage: navigation.nextLabel,
                prevSlideMessage: navigation.previousLabel,
              }
            : {}),
          ...(typeof configuredA11y === "object" ? configuredA11y : {}),
          ...(integration.a11y ?? {}),
          enabled: true,
        };
  const modules = uniqueModules([
    ...(a11y === false ? [] : [A11y]),
    ...(navigation ? [Navigation] : []),
    ...(pagination ? [Pagination] : []),
    ...configuredModules,
    ...(integration.modules ?? []),
  ]);

  return {
    ...swiperOptions,
    ...(a11y === false ? { a11y: false } : { a11y }),
    ...(navigation ? { navigation: navigation.options } : {}),
    ...(pagination ? { pagination } : {}),
    modules,
  };
}

function resolveNavigation(
  root: HTMLElement,
  configuration: false | WebflowSwiperNavigationOptions | undefined,
): ResolvedNavigation | undefined {
  if (configuration === false) return undefined;
  const previous = resolveElement(
    root,
    configuration?.previous,
    defaultPreviousSelector,
    "previous navigation control",
  );
  const next = resolveElement(
    root,
    configuration?.next,
    defaultNextSelector,
    "next navigation control",
  );
  if (!previous && !next) return undefined;
  if (!previous || !next) {
    throw new Error("Webflow Swiper navigation requires both previous and next controls.");
  }
  const ButtonConstructor = root.ownerDocument.defaultView?.HTMLButtonElement;
  if (!ButtonConstructor || !(previous instanceof ButtonConstructor)) {
    throw new TypeError("The previous Webflow Swiper control must be a native button.");
  }
  if (!(next instanceof ButtonConstructor)) {
    throw new TypeError("The next Webflow Swiper control must be a native button.");
  }

  const previousLabel = configuration?.previousLabel?.trim();
  const nextLabel = configuration?.nextLabel?.trim();
  const existingPreviousLabel = getAccessibleName(previous);
  const existingNextLabel = getAccessibleName(next);
  if (!existingPreviousLabel && !previousLabel) {
    throw new Error(
      "The previous Webflow Swiper button needs an accessible name or previousLabel.",
    );
  }
  if (!existingNextLabel && !nextLabel) {
    throw new Error("The next Webflow Swiper button needs an accessible name or nextLabel.");
  }

  if (previous.type !== "button" || next.type !== "button") {
    throw new Error('Webflow Swiper navigation controls must use type="button".');
  }

  return {
    nextLabel: nextLabel ?? existingNextLabel!,
    options: { nextEl: next, prevEl: previous },
    previousLabel: previousLabel ?? existingPreviousLabel!,
  };
}

function resolvePagination(
  root: HTMLElement,
  configuration: false | WebflowSwiperPaginationOptions | undefined,
): { clickable: boolean; el: HTMLElement } | undefined {
  if (configuration === false) return undefined;
  const element = resolveElement(
    root,
    configuration?.element,
    defaultPaginationSelector,
    "pagination element",
  );
  if (!element) return undefined;
  return { clickable: configuration?.clickable ?? true, el: element };
}

function resolveElement(
  root: HTMLElement,
  reference: WebflowSwiperElementReference | undefined,
  fallbackSelector: string,
  label: string,
): HTMLElement | undefined {
  const element =
    typeof reference === "string"
      ? root.querySelector(reference)
      : (reference ?? root.querySelector(fallbackSelector));
  if (!element) {
    if (reference !== undefined) throw new Error(`Could not find the configured ${label}.`);
    return undefined;
  }
  const HTMLElementConstructor = root.ownerDocument.defaultView?.HTMLElement;
  if (!HTMLElementConstructor || !(element instanceof HTMLElementConstructor)) {
    throw new TypeError(`The configured ${label} must be an HTML element.`);
  }
  if (!root.contains(element)) {
    throw new Error(`The configured ${label} must be inside its slider root.`);
  }
  return element;
}

function getAccessibleName(button: HTMLButtonElement): string | undefined {
  const directLabel = button.getAttribute("aria-label")?.trim();
  if (directLabel) return directLabel;
  const labelledBy = button.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/u)
      .map((id) => button.ownerDocument.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (label) return label;
  }
  const title = button.getAttribute("title")?.trim();
  if (title) return title;
  const text = button.textContent?.trim();
  return text || undefined;
}

function uniqueModules(modules: readonly WebflowSwiperModule[]): WebflowSwiperModule[] {
  return [...new Set(modules)];
}
