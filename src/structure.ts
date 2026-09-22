import type { SwiperOptions } from "swiper/types";

export interface SwiperStructureOptions {
  /** Scoped selector; defaults to [data-wft-slider-track]. */
  track?: string;
  /** Scoped selector inside the track. Defaults to marked slides, or all direct children. */
  slides?: string;
  /** Defaults to [data-wft-slider-container], or the track's existing parent. Use :scope for the root. */
  container?: string;
  /** Apply temporary flex layout while enabled. Defaults to true. */
  layout?: boolean;
  /** Let Swiper's spaceBetween own spacing while enabled. Defaults to true with layout. */
  clearGap?: boolean;
  /** Stretch horizontal slides to equal height while enabled. Defaults to false. */
  equalHeight?: boolean;
  /** Opt into inline-size containment for a container inside a grid/flex layout. */
  containInlineSize?: boolean;
}

export interface SwiperStructureIssue {
  reason:
    "missing-track" | "ambiguous-track" | "invalid-container" | "missing-slides" | "invalid-slides";
  message: string;
}

export interface ResolvedSwiperStructure {
  container: HTMLElement;
  track: HTMLElement;
  slides: HTMLElement[];
  options: SwiperStructureOptions;
}

/** Nested slider components own their own markup and controls. */
export function isInSliderScope(root: HTMLElement, element: Element): boolean {
  let current: Element | null = element;
  while (current && current !== root) {
    if (current.hasAttribute("data-wft-slider")) return false;
    current = current.parentElement;
  }
  return current === root;
}

function select(root: HTMLElement, selector: string, scope = root): HTMLElement[] {
  const elements =
    selector === ":scope"
      ? [root]
      : [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  const Constructor = root.ownerDocument.defaultView?.HTMLElement;
  return elements.filter((element): element is HTMLElement =>
    Boolean(Constructor && element instanceof Constructor && isInSliderScope(scope, element)),
  );
}

export function resolveSwiperStructure(
  root: HTMLElement,
  configuration: true | SwiperStructureOptions,
): ResolvedSwiperStructure | SwiperStructureIssue {
  const options = configuration === true ? {} : configuration;
  const tracks = select(root, options.track ?? "[data-wft-slider-track]");
  const track = tracks[0];
  if (!track)
    return { reason: "missing-track", message: "No slider track found inside this root." };
  if (tracks.length !== 1) {
    return {
      reason: "ambiguous-track",
      message: "A slider root must resolve to exactly one track.",
    };
  }
  const containers = select(root, options.container ?? "[data-wft-slider-container]");
  const container = containers[0] ?? (options.container ? null : track.parentElement);
  if (
    containers.length > 1 ||
    !container ||
    !isInSliderScope(root, container) ||
    track.parentElement !== container
  ) {
    return {
      reason: "invalid-container",
      message: "The slider container must be the track's direct parent inside this root.",
    };
  }
  // Ignore non-rendered author scripts/templates rather than turning them into slides.
  const marked = select(track, "[data-wft-slider-slide]", root);
  const slides = select(
    track,
    options.slides ?? (marked.length ? "[data-wft-slider-slide]" : ":scope > *"),
    root,
  ).filter((element) => !["SCRIPT", "STYLE", "TEMPLATE"].includes(element.tagName));
  if (slides.some((slide) => slide.parentElement !== track)) {
    return {
      reason: "invalid-slides",
      message:
        "Slider slides must be direct children of the track; mark the CMS item, not its inner card.",
    };
  }
  if (!slides.length)
    return { reason: "missing-slides", message: "The slider track has no slides yet." };
  return { container, track, slides, options };
}

export function validateStructureSwiperOptions(
  options: SwiperOptions,
  structure: SwiperStructureOptions,
): void {
  if (
    (options.wrapperClass !== undefined && options.wrapperClass !== "swiper-wrapper") ||
    (options.slideClass !== undefined && options.slideClass !== "swiper-slide") ||
    options.createElements ||
    options.virtual === true ||
    (typeof options.virtual === "object" && options.virtual.enabled)
  ) {
    throw new Error(
      "Attribute structure uses existing author slides and standard Swiper runtime classes. " +
        "Do not combine it with renamed wrapper/slide classes, createElements, or virtual slides.",
    );
  }
  if (structure.layout !== false && (options.grid?.rows ?? 1) > 1) {
    throw new Error(
      "Multi-row Swiper Grid requires structure.layout: false and project-owned layout CSS.",
    );
  }
  for (const breakpoint of Object.values(options.breakpoints ?? {})) {
    validateStructureSwiperOptions(breakpoint, structure);
  }
}

export function prepareSwiperStructure(
  structure: ResolvedSwiperStructure,
  swiper: SwiperOptions,
): void {
  const { container, track, slides, options } = structure;
  container.classList.add("swiper");
  track.classList.add("swiper-wrapper");
  for (const slide of slides) slide.classList.add("swiper-slide");
  const a11y = swiper.a11y;
  if (
    typeof a11y === "object" &&
    a11y.enabled !== false &&
    (a11y.slideRole ?? "group") !== "" &&
    (a11y.slideRole ?? "group") !== "listitem"
  ) {
    // Webflow CMS list semantics conflict with upstream A11y's carousel groups.
    // The controller's pre-enhancement snapshot restores these roles on teardown.
    if (
      ["UL", "OL"].includes(track.tagName) &&
      (!track.hasAttribute("role") || track.getAttribute("role")?.trim().toLowerCase() === "list")
    ) {
      track.setAttribute("role", "presentation");
    } else if (track.getAttribute("role")?.trim().toLowerCase() === "list") {
      track.removeAttribute("role");
    }
  }
  if (options.layout === false) return;

  track.style.display = "flex";
  track.style.flexDirection = swiper.direction === "vertical" ? "column" : "row";
  track.style.flexWrap = "nowrap";
  track.style.justifyContent = "flex-start";
  if (options.clearGap !== false) {
    track.style.gap = "0px";
    track.style.columnGap = "0px";
    track.style.rowGap = "0px";
  }
  if (options.equalHeight) track.style.alignItems = "stretch";
  for (const slide of slides) {
    slide.style.flexGrow = "0";
    slide.style.flexShrink = "0";
    slide.style.flexBasis = "auto";
    if (options.equalHeight) slide.style.height = "auto";
  }
  if (options.containInlineSize) {
    const contain = container.ownerDocument.defaultView?.getComputedStyle(container).contain ?? "";
    if (!/(^|\s)(size|inline-size|strict)(\s|$)/u.test(contain)) {
      container.style.contain =
        contain === "content"
          ? "layout paint style inline-size"
          : [
              ...contain.split(/\s+/u).filter((value) => value && value !== "none"),
              "inline-size",
            ].join(" ");
    }
  }
}

/** Keep temporary mechanics in sync with upstream direction/breakpoints without replacing user hooks. */
export function withStructureEvents(
  structure: ResolvedSwiperStructure,
  options: SwiperOptions,
): SwiperOptions {
  return {
    ...options,
    on: {
      ...options.on,
      beforeInit(swiper) {
        prepareSwiperStructure(structure, swiper.params);
        options.on?.beforeInit?.call(this, swiper);
      },
      breakpoint(swiper, parameters) {
        prepareSwiperStructure(structure, swiper.params);
        options.on?.breakpoint?.call(this, swiper, parameters);
      },
      changeDirection(swiper) {
        prepareSwiperStructure(structure, swiper.params);
        options.on?.changeDirection?.call(this, swiper);
      },
    },
  };
}
