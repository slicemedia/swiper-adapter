import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createResponsiveSwiper as createResponsiveSwiperRuntime,
  isViewportEnabled,
  type SwiperFactory,
  type SwiperLike,
  type ResponsiveSwiperOptions,
} from "./index.js";

function createResponsiveSwiper(options: ResponsiveSwiperOptions) {
  return createResponsiveSwiperRuntime({ deferUntilMeasurable: false, ...options });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setViewport(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

describe("responsive Swiper controller", () => {
  it("enables and disables every matching instance at the configured breakpoint", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide" data-original="one"></article></div>
      </div>
      <div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide" data-original="two"></article></div>
      </div>
    `;
    setViewport(640);
    const destroy = vi.fn();
    const update = vi.fn();
    const factory: SwiperFactory = vi.fn((element) => {
      element.classList.add("swiper-initialized");
      element.querySelector(".swiper-slide")?.setAttribute("role", "group");
      element.insertAdjacentHTML("beforeend", '<span class="swiper-notification"></span>');
      return { destroy, update };
    });
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      enabled: { maxWidth: 767 },
      factory,
      window,
      document,
    });

    controller.init();
    controller.init();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toEqual({ initialized: true, enabled: true, instanceCount: 2 });

    setViewport(900);
    controller.refresh();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".swiper-notification")).toBeNull();
    expect(document.querySelector("[role=group]")).toBeNull();
    expect(document.querySelector(".swiper-initialized")).toBeNull();

    setViewport(600);
    controller.refresh();
    expect(factory).toHaveBeenCalledTimes(4);
    controller.destroy();
    expect(controller.getState()).toEqual({ initialized: false, enabled: false, instanceCount: 0 });
  });

  it("handles missing and dynamically inserted markup", () => {
    setViewport(500);
    const factory: SwiperFactory = vi.fn(() => ({ destroy: vi.fn(), update: vi.fn() }));
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory,
      document,
      window,
    });

    expect(() => controller.init()).not.toThrow();
    expect(controller.getState().instanceCount).toBe(0);
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>
    `;
    controller.refresh();
    expect(controller.getState().instanceCount).toBe(1);
    controller.destroy();
  });

  it("rolls back DOM changes when Swiper initialization fails", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider aria-label="Items">
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>
    `;
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      document,
      window,
      factory: (element) => {
        element.classList.add("swiper-initialized");
        element.setAttribute("role", "region");
        throw new Error("factory failed");
      },
    });

    expect(() => controller.init()).toThrow("factory failed");
    const element = document.querySelector<HTMLElement>("[data-slider]")!;
    expect(element.classList.contains("swiper-initialized")).toBe(false);
    expect(element.hasAttribute("role")).toBe(false);
    expect(element.getAttribute("aria-label")).toBe("Items");
    expect(controller.getState().initialized).toBe(false);
  });

  it("restores author-provided accessibility attributes during cleanup", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider aria-label="Featured items">
        <div class="swiper-wrapper">
          <article class="swiper-slide" tabindex="0"></article>
        </div>
      </div>
    `;
    const factory: SwiperFactory = (element) => {
      element.setAttribute("aria-label", "Swiper");
      element.setAttribute("role", "region");
      element.querySelector(".swiper-slide")?.setAttribute("tabindex", "-1");
      return { destroy: vi.fn(), update: vi.fn() };
    };
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory,
      document,
      window,
    });

    controller.init();
    controller.destroy();
    const root = document.querySelector<HTMLElement>("[data-slider]")!;
    expect(root.getAttribute("aria-label")).toBe("Featured items");
    expect(root.hasAttribute("role")).toBe(false);
    expect(root.querySelector(".swiper-slide")?.getAttribute("tabindex")).toBe("0");

    controller.init();
    expect(controller.getState().instanceCount).toBe(1);
    controller.destroy();
  });

  it("cleans accessibility changes from dynamically added slides", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper"></div>
      </div>
    `;
    const factory: SwiperFactory = (element) => ({
      destroy: vi.fn(),
      update: () => {
        element.querySelector("[data-new-slide]")?.setAttribute("role", "group");
      },
    });
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory,
      document,
      window,
    });
    controller.init();
    document
      .querySelector(".swiper-wrapper")
      ?.insertAdjacentHTML(
        "beforeend",
        '<article class="swiper-slide" data-new-slide aria-label="New item"></article>',
      );
    controller.refresh();
    expect(document.querySelector("[data-new-slide]")?.getAttribute("role")).toBe("group");

    controller.destroy();
    const slide = document.querySelector("[data-new-slide]");
    expect(slide?.hasAttribute("role")).toBe(false);
    expect(slide?.getAttribute("aria-label")).toBe("New item");
  });

  it("observes later CMS slider roots and stops observing after destroy", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        queueMicrotask(() => callback(performance.now()));
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const factory: SwiperFactory = vi.fn(() => ({ destroy: vi.fn(), update: vi.fn() }));
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory,
      document,
      window,
      observeMutations: true,
    });

    controller.init();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>`,
    );

    await vi.waitFor(() => expect(controller.getState().instanceCount).toBe(1));
    controller.destroy();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>`,
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("removes vendor-created nodes while retaining and restoring later CMS slides", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide">Initial</article></div>
      </div>
    `;
    const factory: SwiperFactory = (element) => {
      element.insertAdjacentHTML("beforeend", '<div class="swiper-pagination"></div>');
      return {
        destroy: vi.fn(),
        update: () => {
          element.querySelector("[data-cms-slide]")?.setAttribute("role", "group");
          if (!element.querySelector(".swiper-scrollbar")) {
            element.insertAdjacentHTML("beforeend", '<div class="swiper-scrollbar"></div>');
          }
        },
      };
    };
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory,
      document,
      window,
    });

    controller.init();
    document
      .querySelector(".swiper-wrapper")
      ?.insertAdjacentHTML(
        "beforeend",
        '<article class="swiper-slide" data-cms-slide aria-label="Later item"></article>',
      );
    controller.refresh();
    expect(document.querySelector("[data-cms-slide]")?.getAttribute("role")).toBe("group");

    controller.destroy();
    expect(document.querySelector(".swiper-pagination")).toBeNull();
    expect(document.querySelector(".swiper-scrollbar")).toBeNull();
    expect(document.querySelector("[data-cms-slide]")?.hasAttribute("role")).toBe(false);
    expect(document.querySelector("[data-cms-slide]")?.getAttribute("aria-label")).toBe(
      "Later item",
    );
  });

  it("restores a detached root before releasing it", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider aria-label="Authored">
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>
    `;
    const root = document.querySelector<HTMLElement>("[data-slider]")!;
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      document,
      window,
      factory: (element) => {
        element.setAttribute("role", "region");
        element.setAttribute("aria-label", "Swiper");
        return { destroy: vi.fn(), update: vi.fn() };
      },
    });

    controller.init();
    root.remove();
    controller.refresh();
    expect(root.hasAttribute("role")).toBe(false);
    expect(root.getAttribute("aria-label")).toBe("Authored");
    expect(controller.getState().instanceCount).toBe(0);
    controller.destroy();
  });

  it("allows only one controller from the loaded adapter module to own a root", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>
    `;
    const firstFactory: SwiperFactory = vi.fn(() => ({ destroy: vi.fn(), update: vi.fn() }));
    const secondFactory: SwiperFactory = vi.fn(() => ({ destroy: vi.fn(), update: vi.fn() }));
    const first = createResponsiveSwiper({
      target: "[data-slider]",
      factory: firstFactory,
      document,
      window,
    });
    const second = createResponsiveSwiper({
      target: "[data-slider]",
      factory: secondFactory,
      document,
      window,
    });
    const conflicts = vi.fn();
    second.on("ownershipConflict", conflicts);

    first.init();
    second.init();
    expect(firstFactory).toHaveBeenCalledOnce();
    expect(secondFactory).not.toHaveBeenCalled();
    expect(conflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "adapter",
        element: document.querySelector("[data-slider]"),
      }),
    );

    first.destroy();
    second.refresh();
    expect(secondFactory).toHaveBeenCalledOnce();
    second.destroy();
  });

  it("does not take ownership from a Swiper instance created outside the adapter", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>
    `;
    const root = document.querySelector<HTMLElement>("[data-slider]")! as HTMLElement & {
      swiper?: { destroyed: boolean };
    };
    root.swiper = { destroyed: false };
    const factory: SwiperFactory = vi.fn(() => ({ destroy: vi.fn(), update: vi.fn() }));
    const controller = createResponsiveSwiper({ target: root, factory, document, window });
    const conflicts = vi.fn();
    controller.on("ownershipConflict", conflicts);

    controller.init();
    expect(factory).not.toHaveBeenCalled();
    expect(conflicts).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "external-swiper", element: root }),
    );
    controller.destroy();
    delete root.swiper;
  });

  it("preserves the active logical slide by its stable key after CMS insertion", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper">
          <article class="swiper-slide" data-wft-slide-key="a"></article>
          <article class="swiper-slide" data-wft-slide-key="b"></article>
          <article class="swiper-slide" data-wft-slide-key="c"></article>
        </div>
      </div>
    `;
    const root = document.querySelector<HTMLElement>("[data-slider]")!;
    const instance: SwiperLike = {
      activeIndex: 1,
      destroy: vi.fn(),
      slideTo: vi.fn((index: number) => {
        instance.activeIndex = index;
      }),
      slides: [...root.querySelectorAll(".swiper-slide")],
      update: vi.fn(() => {
        instance.slides = [...root.querySelectorAll(".swiper-slide")];
      }),
    };
    const controller = createResponsiveSwiper({
      target: root,
      factory: () => instance,
      document,
      window,
    });
    controller.init();
    root
      .querySelector(".swiper-wrapper")
      ?.insertAdjacentHTML(
        "afterbegin",
        '<article class="swiper-slide" data-wft-slide-key="new"></article>',
      );

    controller.refresh();
    expect(instance.slideTo).toHaveBeenLastCalledWith(2, 0, false);
    expect(instance.activeIndex).toBe(2);
    controller.destroy();
    expect(root.querySelector('[data-wft-slide-key="new"]')).not.toBeNull();
  });

  it("uses Swiper's logical slide index when restoring a keyed loop slide", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper">
          <article class="swiper-slide" data-wft-slide-key="c" data-swiper-slide-index="2"></article>
          <article class="swiper-slide" data-wft-slide-key="a" data-swiper-slide-index="0"></article>
          <article class="swiper-slide" data-wft-slide-key="b" data-swiper-slide-index="1"></article>
        </div>
      </div>
    `;
    const root = document.querySelector<HTMLElement>("[data-slider]")!;
    const instance: SwiperLike = {
      activeIndex: 2,
      destroy: vi.fn(),
      params: { loop: true },
      realIndex: 1,
      slideToLoop: vi.fn(),
      slides: [...root.querySelectorAll(".swiper-slide")],
      update: vi.fn(() => {
        instance.slides = [...root.querySelectorAll(".swiper-slide")];
      }),
    };
    const controller = createResponsiveSwiper({
      target: root,
      factory: () => instance,
      document,
      window,
    });
    controller.init();
    root
      .querySelector(".swiper-wrapper")
      ?.insertAdjacentHTML(
        "afterbegin",
        '<article class="swiper-slide" data-wft-slide-key="new" data-swiper-slide-index="3"></article>',
      );

    controller.refresh();
    expect(instance.slideToLoop).toHaveBeenLastCalledWith(1, 0, false);
    controller.destroy();
  });

  it("uses the refreshed active index for an unindexed keyed loop replacement", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider>
        <div class="swiper-wrapper">
          <article class="swiper-slide" data-wft-slide-key="a" data-swiper-slide-index="0"></article>
          <article class="swiper-slide" data-wft-slide-key="b" data-swiper-slide-index="1"></article>
          <article class="swiper-slide" data-wft-slide-key="c" data-swiper-slide-index="2"></article>
        </div>
      </div>
    `;
    const root = document.querySelector<HTMLElement>("[data-slider]")!;
    const slideTo = vi.fn();
    const slideToLoop = vi.fn();
    const instance: SwiperLike = {
      activeIndex: 1,
      destroy: vi.fn(),
      params: { loop: true },
      realIndex: 1,
      slideTo,
      slideToLoop,
      slides: [...root.querySelectorAll(".swiper-slide")],
      update: vi.fn(() => {
        instance.slides = [...root.querySelectorAll(".swiper-slide")];
      }),
    };
    const controller = createResponsiveSwiper({
      target: root,
      factory: () => instance,
      document,
      window,
    });
    controller.init();
    root.querySelector(".swiper-wrapper")!.innerHTML = `
      <article class="swiper-slide" data-wft-slide-key="new"></article>
      <article class="swiper-slide" data-wft-slide-key="a"></article>
      <article class="swiper-slide" data-wft-slide-key="b"></article>
      <article class="swiper-slide" data-wft-slide-key="c"></article>
    `;

    controller.refresh();
    expect(slideTo).toHaveBeenLastCalledWith(2, 0, false);
    expect(slideToLoop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("defers hidden roots and refreshes them when ResizeObserver reports measurable layout", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider data-measurable="false">
        <div class="swiper-wrapper"><article class="swiper-slide"></article></div>
      </div>
    `;
    let resizeCallback: ResizeObserverCallback | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    let queuedFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queuedFrame = callback;
      return 23;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const root = document.querySelector<HTMLElement>("[data-slider]")!;
    const update = vi.fn();
    const factory: SwiperFactory = vi.fn(() => ({ destroy: vi.fn(), update }));
    const controller = createResponsiveSwiperRuntime({
      target: root,
      isMeasurable: (element) => element.dataset.measurable === "true",
      factory,
      document,
      window,
    });

    controller.init();
    expect(factory).not.toHaveBeenCalled();
    root.dataset.measurable = "true";
    resizeCallback?.([], {} as ResizeObserver);
    queuedFrame?.(performance.now());
    expect(factory).toHaveBeenCalledOnce();
    update.mockClear();

    root.dataset.measurable = "false";
    resizeCallback?.([], {} as ResizeObserver);
    queuedFrame?.(performance.now());
    expect(update).not.toHaveBeenCalled();
    root.dataset.measurable = "true";
    resizeCallback?.([], {} as ResizeObserver);
    queuedFrame?.(performance.now());
    expect(update).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it("reconciles target and Swiper option changes through setOptions", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider="first"><div class="swiper-wrapper"></div></div>
      <div class="swiper" data-slider="second"><div class="swiper-wrapper"></div></div>
    `;
    const destroy = vi.fn();
    const factory: SwiperFactory = vi.fn(() => ({ destroy, update: vi.fn() }));
    const controller = createResponsiveSwiper({
      target: '[data-slider="first"]',
      factory,
      document,
      window,
    });
    controller.init();

    controller.setOptions({ target: '[data-slider="second"]' });
    expect(destroy).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(controller.getState().instanceCount).toBe(1);

    controller.setOptions({ swiper: { speed: 250 } });
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenLastCalledWith(
      document.querySelector('[data-slider="second"]'),
      expect.objectContaining({ speed: 250 }),
    );
    controller.destroy();
  });

  it("emits lifecycle events and honors listener unsubscription", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider><div class="swiper-wrapper"></div></div>
    `;
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory: () => ({ destroy: vi.fn(), update: vi.fn() }),
      document,
      window,
    });
    const events: string[] = [];
    controller.on("enable", () => events.push("enable"));
    controller.on("init", () => events.push("init"));
    const removeRefreshListener = controller.on("refresh", () => events.push("refresh"));
    controller.on("destroy", () => events.push("destroy"));

    controller.init();
    controller.refresh();
    removeRefreshListener();
    controller.refresh();
    controller.destroy();
    expect(events).toEqual(["enable", "init", "refresh", "destroy"]);
  });

  it("coalesces queued window resizes into one refresh frame", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider><div class="swiper-wrapper"></div></div>
    `;
    let queuedFrame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queuedFrame = callback;
        return 17;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const update = vi.fn();
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory: () => ({ destroy: vi.fn(), update }),
      document,
      window,
    });
    controller.init();

    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(requestFrame).toHaveBeenCalledOnce();
    queuedFrame?.(performance.now());
    expect(update).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it("restores every root even when vendor teardown fails", () => {
    document.body.innerHTML = `
      <div class="swiper" data-slider><div class="swiper-wrapper"></div></div>
      <div class="swiper" data-slider><div class="swiper-wrapper"></div></div>
    `;
    const controller = createResponsiveSwiper({
      target: "[data-slider]",
      factory: (element) => {
        element.setAttribute("role", "region");
        return {
          destroy: () => {
            throw new Error("vendor cleanup failed");
          },
          update: vi.fn(),
        };
      },
      document,
      window,
    });
    controller.init();

    expect(() => controller.destroy()).toThrow(AggregateError);
    expect(document.querySelector("[role=region]")).toBeNull();
    expect(controller.getState()).toEqual({ initialized: false, enabled: false, instanceCount: 0 });
  });
});

describe("isViewportEnabled", () => {
  it("supports inclusive ranges and predicates", () => {
    expect(isViewportEnabled({ minWidth: 480, maxWidth: 767 }, 480)).toBe(true);
    expect(isViewportEnabled({ minWidth: 480, maxWidth: 767 }, 768)).toBe(false);
    expect(isViewportEnabled((width) => width % 2 === 0, 500)).toBe(true);
  });
});
