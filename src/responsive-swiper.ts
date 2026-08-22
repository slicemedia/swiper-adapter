import Swiper from "swiper";
import type { SwiperOptions } from "swiper/types";

export interface SwiperLike {
  activeIndex?: number;
  destroyed?: boolean;
  destroy(deleteInstance?: boolean, cleanStyles?: boolean): void;
  params?: { loop?: boolean };
  realIndex?: number;
  slideTo?(index: number, speed?: number, runCallbacks?: boolean): unknown;
  slideToLoop?(index: number, speed?: number, runCallbacks?: boolean): unknown;
  slides?: ArrayLike<Element>;
  update(): void;
}

export type SwiperFactory = (element: HTMLElement, options: SwiperOptions) => SwiperLike;

export interface ViewportRange {
  minWidth?: number;
  maxWidth?: number;
}

export interface ResponsiveSwiperOptions {
  target: string | HTMLElement | Iterable<HTMLElement>;
  swiper?: SwiperOptions | ((element: HTMLElement, index: number) => SwiperOptions);
  enabled?: ViewportRange | ((viewportWidth: number) => boolean);
  factory?: SwiperFactory;
  document?: Document;
  window?: Window;
  /** Defaults to true so hidden Webflow tabs and components do not initialize at zero width. */
  deferUntilMeasurable?: boolean;
  /** Overrides the browser geometry check, primarily for custom elements and deterministic tests. */
  isMeasurable?: (element: HTMLElement) => boolean;
  observeMutations?: boolean;
  /** Defaults to true while measurable-root deferral is enabled. */
  observeResize?: boolean;
  /** Defaults to true and restores a surviving element or stable slide key after update. */
  preserveActiveSlide?: boolean;
  /** Defaults to data-wft-slide-key. Set false to disable key lookup. */
  slideKeyAttribute?: string | false;
}

export interface ResponsiveSwiperState {
  initialized: boolean;
  enabled: boolean;
  instanceCount: number;
}

export interface ResponsiveSwiperEventMap {
  init: ResponsiveSwiperState;
  refresh: ResponsiveSwiperState;
  enable: ResponsiveSwiperState;
  disable: ResponsiveSwiperState;
  destroy: ResponsiveSwiperState;
  ownershipConflict: ResponsiveSwiperOwnershipConflict;
}

export interface ResponsiveSwiperOwnershipConflict {
  element: HTMLElement;
  /** Identifies another controller from this module or a standard element.swiper instance. */
  owner: "adapter" | "external-swiper";
  state: ResponsiveSwiperState;
}

export type ResponsiveSwiperEvent = keyof ResponsiveSwiperEventMap;

export interface ResponsiveSwiperController {
  init(): void;
  refresh(): void;
  update(): void;
  destroy(): void;
  setOptions(options: Partial<ResponsiveSwiperOptions>): void;
  getState(): ResponsiveSwiperState;
  on<Event extends ResponsiveSwiperEvent>(
    event: Event,
    listener: (state: ResponsiveSwiperEventMap[Event]) => void,
  ): () => void;
}

interface ElementSnapshot {
  element: Element;
  attributes: ReadonlyMap<string, string>;
}

interface ManagedSwiper {
  instance: SwiperLike;
  snapshots: ElementSnapshot[];
  originalElements: Set<Element>;
  ownedElements: Set<Element>;
}

interface SlideAnchor {
  element?: HTMLElement;
  index: number;
  key?: string;
}

const defaultFactory: SwiperFactory = (element, options) => new Swiper(element, options);
const rootOwners = new WeakMap<HTMLElement, object>();

export function isViewportEnabled(
  enabled: ResponsiveSwiperOptions["enabled"],
  viewportWidth: number,
): boolean {
  if (typeof enabled === "function") return enabled(viewportWidth);
  if (!enabled) return true;
  if (enabled.minWidth !== undefined && viewportWidth < enabled.minWidth) return false;
  if (enabled.maxWidth !== undefined && viewportWidth > enabled.maxWidth) return false;
  return true;
}

function snapshotTree(root: HTMLElement): {
  snapshots: ElementSnapshot[];
  originalElements: Set<Element>;
} {
  const elements = [root, ...root.querySelectorAll("*")];
  return {
    snapshots: elements.map((element) => ({
      element,
      attributes: new Map([...element.attributes].map(({ name, value }) => [name, value])),
    })),
    originalElements: new Set(elements),
  };
}

function snapshotNewAuthorElements(managed: ManagedSwiper, root: HTMLElement): void {
  for (const element of root.querySelectorAll("*")) {
    if (managed.originalElements.has(element) || isInsideOwnedTree(managed, element)) continue;
    managed.originalElements.add(element);
    managed.snapshots.push({
      element,
      attributes: new Map([...element.attributes].map(({ name, value }) => [name, value])),
    });
  }
}

function isInsideOwnedTree(managed: ManagedSwiper, element: Element): boolean {
  for (const ownedElement of managed.ownedElements) {
    if (ownedElement === element || ownedElement.contains(element)) return true;
  }
  return false;
}

function captureOwnedElements(
  managed: ManagedSwiper,
  root: HTMLElement,
  elementsBeforeVendorWork: ReadonlySet<Element>,
): void {
  for (const element of root.querySelectorAll("*")) {
    if (!elementsBeforeVendorWork.has(element) && !managed.originalElements.has(element)) {
      managed.ownedElements.add(element);
    }
  }
}

function removeVendorElements(
  managed: Pick<ManagedSwiper, "originalElements" | "ownedElements">,
): void {
  for (const element of [...managed.ownedElements].reverse()) {
    const containsAuthorContent = [...managed.originalElements].some(
      (authorElement) => authorElement !== element && element.contains(authorElement),
    );
    if (!containsAuthorContent) element.remove();
  }
  managed.ownedElements.clear();
}

function removeElementsAddedAfterSnapshot(
  snapshot: Pick<ManagedSwiper, "originalElements">,
  root: HTMLElement,
): void {
  const addedElements = [...root.querySelectorAll("*")].filter(
    (element) => !snapshot.originalElements.has(element),
  );
  for (const element of addedElements.reverse()) {
    const containsAuthorContent = [...snapshot.originalElements].some((authorElement) =>
      element.contains(authorElement),
    );
    if (!containsAuthorContent) element.remove();
  }
}

function restoreTree(managed: Pick<ManagedSwiper, "snapshots">): void {
  for (const { element, attributes } of managed.snapshots) {
    for (const { name } of [...element.attributes]) {
      if (!attributes.has(name)) element.removeAttribute(name);
    }
    for (const [name, value] of attributes) element.setAttribute(name, value);
  }
}

function resolveElements(
  target: ResponsiveSwiperOptions["target"],
  documentObject: Document | undefined,
): HTMLElement[] {
  if (typeof target === "string") {
    return documentObject ? [...documentObject.querySelectorAll<HTMLElement>(target)] : [];
  }
  const HTMLElementConstructor = documentObject?.defaultView?.HTMLElement;
  if (HTMLElementConstructor && target instanceof HTMLElementConstructor) {
    return target.isConnected ? [target as HTMLElement] : [];
  }
  return [...(target as Iterable<HTMLElement>)].filter(
    (element) =>
      element.isConnected && (!HTMLElementConstructor || element instanceof HTMLElementConstructor),
  );
}

function getSwiperSlides(instance: SwiperLike, root: HTMLElement): HTMLElement[] {
  const elements = instance.slides
    ? Array.from(instance.slides)
    : Array.from(root.querySelectorAll(".swiper-slide"));
  const HTMLElementConstructor = root.ownerDocument.defaultView?.HTMLElement;

  return elements.filter(
    (element): element is HTMLElement =>
      !HTMLElementConstructor || element instanceof HTMLElementConstructor,
  );
}

function readSlideKey(
  element: HTMLElement | undefined,
  options: ResponsiveSwiperOptions,
): string | undefined {
  const attribute = options.slideKeyAttribute ?? "data-wft-slide-key";
  if (!element || attribute === false) return undefined;
  const value = element.getAttribute(attribute)?.trim();
  return value || undefined;
}

function captureSlideAnchor(
  instance: SwiperLike,
  root: HTMLElement,
  options: ResponsiveSwiperOptions,
): SlideAnchor | undefined {
  if (options.preserveActiveSlide === false) return undefined;
  const slides = getSwiperSlides(instance, root);
  if (slides.length === 0) return undefined;
  const activeIndex = Number.isInteger(instance.activeIndex) ? (instance.activeIndex ?? 0) : 0;
  const logicalIndex = Number.isInteger(instance.realIndex)
    ? (instance.realIndex ?? activeIndex)
    : activeIndex;
  const element = slides[activeIndex] ?? slides[logicalIndex];
  const key = readSlideKey(element, options);

  return {
    ...(element ? { element } : {}),
    index: Math.max(0, logicalIndex),
    ...(key ? { key } : {}),
  };
}

function restoreSlideAnchor(
  instance: SwiperLike,
  root: HTMLElement,
  options: ResponsiveSwiperOptions,
  anchor: SlideAnchor | undefined,
): void {
  if (!anchor) return;
  const slides = getSwiperSlides(instance, root);
  if (slides.length === 0) return;
  let index = anchor.key
    ? slides.findIndex((slide) => readSlideKey(slide, options) === anchor.key)
    : -1;
  if (index < 0 && anchor.element) index = slides.indexOf(anchor.element);
  if (index < 0) index = Math.min(anchor.index, slides.length - 1);

  if (instance.params?.loop && instance.slideToLoop) {
    const indexedSlide = slides[index];
    const vendorIndexAttribute = indexedSlide?.getAttribute("data-swiper-slide-index");
    const vendorIndex = vendorIndexAttribute === null ? undefined : Number(vendorIndexAttribute);
    if (vendorIndex !== undefined && Number.isInteger(vendorIndex) && vendorIndex >= 0) {
      // Swiper documents slideToLoop() in terms of realIndex. In loop mode the
      // data attribute is the stable mapping from its rearranged slide array.
      instance.slideToLoop(vendorIndex, 0, false);
    } else if (instance.slideTo) {
      // A wholesale CMS replacement may produce fresh, not-yet-indexed nodes.
      // The matched element's current array index is an active index, not a real
      // index, so use slideTo() instead of passing the wrong value to slideToLoop().
      instance.slideTo(index, 0, false);
    } else {
      instance.slideToLoop(index, 0, false);
    }
  } else {
    instance.slideTo?.(index, 0, false);
  }
}

function defaultIsMeasurable(element: HTMLElement): boolean {
  if (!element.isConnected || element.hidden) return false;
  const rectangles = element.getClientRects();
  if (rectangles.length === 0) return false;
  return element.getBoundingClientRect().width > 0;
}

function isExternalSwiperActive(element: HTMLElement): boolean {
  const candidate = (element as HTMLElement & { swiper?: { destroyed?: boolean } }).swiper;
  return Boolean(candidate && !candidate.destroyed);
}

export function createResponsiveSwiper(
  initialOptions: ResponsiveSwiperOptions,
): ResponsiveSwiperController {
  let options = { ...initialOptions };
  let initialized = false;
  let enabled = false;
  let resizeListening = false;
  let observer: MutationObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let frame: number | undefined;
  const ownerToken = {};
  const instances = new Map<HTMLElement, ManagedSwiper>();
  let retainedAnchors = new WeakMap<HTMLElement, SlideAnchor>();
  const resizeObservedElements = new Set<HTMLElement>();
  const listeners = new Map<
    ResponsiveSwiperEvent,
    Set<(payload: ResponsiveSwiperEventMap[ResponsiveSwiperEvent]) => void>
  >();

  const getWindow = (): Window | undefined =>
    options.window ?? options.document?.defaultView ?? globalThis.window;
  const getDocument = (): Document | undefined =>
    options.document ?? options.window?.document ?? globalThis.document;
  const getState = (): ResponsiveSwiperState => ({
    initialized,
    enabled,
    instanceCount: instances.size,
  });
  const emit = <Event extends ResponsiveSwiperEvent>(
    event: Event,
    payload: ResponsiveSwiperEventMap[Event],
  ): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const emitState = (event: Exclude<ResponsiveSwiperEvent, "ownershipConflict">): void =>
    emit(event, getState());

  const isMeasurable = (element: HTMLElement): boolean =>
    options.deferUntilMeasurable === false ||
    (options.isMeasurable ?? defaultIsMeasurable)(element);

  const destroyInstance = (element: HTMLElement, retainAnchor = true): void => {
    const managed = instances.get(element);
    if (!managed) return;
    if (retainAnchor) {
      const anchor = captureSlideAnchor(managed.instance, element, options);
      if (anchor) retainedAnchors.set(element, anchor);
    }
    const errors: unknown[] = [];
    try {
      managed.instance.destroy(true, true);
    } catch (error) {
      errors.push(error);
    }
    instances.delete(element);
    if (rootOwners.get(element) === ownerToken) rootOwners.delete(element);
    try {
      removeVendorElements(managed);
    } catch (error) {
      errors.push(error);
    }
    try {
      restoreTree(managed);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Swiper instance and DOM cleanup both failed.");
    }
  };

  const reconcile = (): void => {
    const windowObject = getWindow();
    const nextEnabled = isViewportEnabled(options.enabled, windowObject?.innerWidth ?? 0);
    const elements = nextEnabled ? resolveElements(options.target, getDocument()) : [];
    const wanted = new Set(elements);

    configureResizeObserver(elements);

    for (const element of instances.keys()) {
      if (!wanted.has(element) || !element.isConnected) destroyInstance(element);
    }

    if (nextEnabled) {
      elements.forEach((element, index) => {
        if (instances.has(element) || !isMeasurable(element)) return;
        const currentOwner = rootOwners.get(element);
        if (currentOwner && currentOwner !== ownerToken) {
          emit("ownershipConflict", {
            element,
            owner: "adapter",
            state: getState(),
          });
          return;
        }
        if (!currentOwner && isExternalSwiperActive(element)) {
          emit("ownershipConflict", {
            element,
            owner: "external-swiper",
            state: getState(),
          });
          return;
        }
        const snapshot = snapshotTree(element);
        rootOwners.set(element, ownerToken);
        try {
          const swiperOptions =
            typeof options.swiper === "function"
              ? options.swiper(element, index)
              : (options.swiper ?? {});
          const instance = (options.factory ?? defaultFactory)(element, swiperOptions);
          const managed: ManagedSwiper = { instance, ...snapshot, ownedElements: new Set() };
          captureOwnedElements(managed, element, snapshot.originalElements);
          instances.set(element, managed);
          restoreSlideAnchor(instance, element, options, retainedAnchors.get(element));
          retainedAnchors.delete(element);
        } catch (error) {
          if (rootOwners.get(element) === ownerToken) rootOwners.delete(element);
          removeElementsAddedAfterSnapshot(snapshot, element);
          restoreTree(snapshot);
          throw error;
        }
      });
    }

    if (enabled !== nextEnabled) {
      enabled = nextEnabled;
      emitState(enabled ? "enable" : "disable");
    } else {
      enabled = nextEnabled;
    }
  };

  const queueRefresh = (): void => {
    const windowObject = getWindow();
    if (!windowObject || frame !== undefined) return;
    if (typeof windowObject.requestAnimationFrame !== "function") {
      controller.refresh();
      return;
    }
    frame = windowObject.requestAnimationFrame(() => {
      frame = undefined;
      controller.refresh();
    });
  };

  const configureMutationObserver = (): void => {
    observer?.disconnect();
    observer = undefined;
    const windowObject = getWindow();
    const documentObject = getDocument();
    const MutationObserverConstructor = (windowObject as (Window & typeof globalThis) | undefined)
      ?.MutationObserver;
    if (!options.observeMutations || !documentObject || !MutationObserverConstructor) return;
    observer = new MutationObserverConstructor(queueRefresh);
    observer.observe(documentObject.documentElement, { childList: true, subtree: true });
  };

  function configureResizeObserver(elements: readonly HTMLElement[] = []): void {
    const windowObject = getWindow();
    const ResizeObserverConstructor = (windowObject as (Window & typeof globalThis) | undefined)
      ?.ResizeObserver;
    const shouldObserve = options.deferUntilMeasurable !== false && options.observeResize !== false;
    if (!shouldObserve || !ResizeObserverConstructor) {
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      resizeObservedElements.clear();
      return;
    }
    resizeObserver ??= new ResizeObserverConstructor(queueRefresh);
    const wanted = new Set(elements);
    for (const element of resizeObservedElements) {
      if (!wanted.has(element)) {
        resizeObserver.unobserve(element);
        resizeObservedElements.delete(element);
      }
    }
    for (const element of elements) {
      if (resizeObservedElements.has(element)) continue;
      resizeObserver.observe(element);
      resizeObservedElements.add(element);
    }
  }

  const controller: ResponsiveSwiperController = {
    init() {
      if (initialized) return;
      initialized = true;
      const windowObject = getWindow();
      if (windowObject && !resizeListening) {
        windowObject.addEventListener("resize", queueRefresh, { passive: true });
        resizeListening = true;
      }
      configureMutationObserver();
      try {
        reconcile();
        emitState("init");
      } catch (error) {
        controller.destroy();
        throw error;
      }
    },
    refresh() {
      if (!initialized) return;
      reconcile();
      for (const [element, managed] of instances) {
        if (!isMeasurable(element)) continue;
        const anchor = captureSlideAnchor(managed.instance, element, options);
        snapshotNewAuthorElements(managed, element);
        const beforeUpdate = new Set(element.querySelectorAll("*"));
        managed.instance.update();
        captureOwnedElements(managed, element, beforeUpdate);
        restoreSlideAnchor(managed.instance, element, options, anchor);
      }
      emitState("refresh");
    },
    update() {
      for (const [element, managed] of instances) {
        if (!isMeasurable(element)) continue;
        const anchor = captureSlideAnchor(managed.instance, element, options);
        snapshotNewAuthorElements(managed, element);
        const beforeUpdate = new Set(element.querySelectorAll("*"));
        managed.instance.update();
        captureOwnedElements(managed, element, beforeUpdate);
        restoreSlideAnchor(managed.instance, element, options, anchor);
      }
    },
    destroy() {
      if (!initialized) return;
      const windowObject = getWindow();
      if (resizeListening && windowObject) {
        windowObject.removeEventListener("resize", queueRefresh);
      }
      resizeListening = false;
      if (frame !== undefined && windowObject) windowObject.cancelAnimationFrame(frame);
      frame = undefined;
      observer?.disconnect();
      observer = undefined;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      resizeObservedElements.clear();
      const errors: unknown[] = [];
      for (const element of [...instances.keys()]) {
        try {
          destroyInstance(element, false);
        } catch (error) {
          errors.push(error);
        }
      }
      initialized = false;
      enabled = false;
      retainedAnchors = new WeakMap();
      emitState("destroy");
      if (errors.length > 0) {
        throw new AggregateError(errors, "One or more Swiper instances failed during cleanup.");
      }
    },
    setOptions(nextOptions) {
      const previousWindow = getWindow();
      const previousDocument = getDocument();
      const needsRecreate = nextOptions.swiper !== undefined || nextOptions.factory !== undefined;
      if (needsRecreate) {
        for (const element of [...instances.keys()]) destroyInstance(element);
      }
      options = { ...options, ...nextOptions };
      if (initialized) {
        const nextWindow = getWindow();
        const nextDocument = getDocument();
        if (previousWindow !== nextWindow) {
          if (resizeListening && previousWindow) {
            previousWindow.removeEventListener("resize", queueRefresh);
          }
          resizeListening = false;
          if (frame !== undefined && previousWindow) previousWindow.cancelAnimationFrame(frame);
          frame = undefined;
          if (nextWindow) {
            nextWindow.addEventListener("resize", queueRefresh, { passive: true });
            resizeListening = true;
          }
        }
        if (
          previousWindow !== nextWindow ||
          previousDocument !== nextDocument ||
          nextOptions.observeMutations !== undefined
        ) {
          configureMutationObserver();
        }
        reconcile();
      }
    },
    getState,
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set();
      const storedListener = listener as (
        payload: ResponsiveSwiperEventMap[ResponsiveSwiperEvent],
      ) => void;
      eventListeners.add(storedListener);
      listeners.set(event, eventListeners);
      return () => eventListeners.delete(storedListener);
    },
  };

  return controller;
}
