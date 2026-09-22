import Swiper from "swiper";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createResponsiveSwiper,
  type ResponsiveSwiperController,
  type ResponsiveSwiperOptions,
  type SwiperLike,
} from "./index.js";
import { createWebflowSwiperOptions } from "./webflow.js";

const controllers: ResponsiveSwiperController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function create(options: Partial<ResponsiveSwiperOptions> = {}) {
  const controller = createResponsiveSwiper({
    target: "[data-wft-slider]",
    structure: true,
    deferUntilMeasurable: false,
    factory: () => ({ destroy: vi.fn(), update: vi.fn() }),
    ...options,
  });
  controllers.push(controller);
  return controller;
}

function render() {
  document.body.innerHTML = `
    <section class="cards-component" data-wft-slider aria-label="Featured cards">
      <div class="cards-cms" style="overflow: visible; contain: layout">
        <div class="cards-grid" data-wft-slider-track role="list" style="display: grid; gap: 24px !important; flex-wrap: wrap">
          <article class="card" data-wft-slider-slide data-wft-slide-key="one" role="listitem" style="width: 18rem; flex-grow: 1">One</article>
          <article class="card" data-wft-slider-slide data-wft-slide-key="two" role="listitem">Two</article>
          <article class="card" data-wft-slider-slide data-wft-slide-key="three" role="listitem">Three</article>
        </div>
      </div>
      <button class="cards-prev" type="button" data-wft-slider-prev>Previous</button>
      <button class="cards-next" type="button" data-wft-slider-next>Next</button>
      <div class="cards-pagination" data-wft-slider-pagination></div>
    </section>`;
  return {
    root: document.querySelector<HTMLElement>("[data-wft-slider]")!,
    container: document.querySelector<HTMLElement>(".cards-cms")!,
    track: document.querySelector<HTMLElement>("[data-wft-slider-track]")!,
  };
}

function viewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

describe("attribute structure", () => {
  it("adapts an existing CMS grid only while enabled and restores authored classes, styles and order", () => {
    const { root, container, track } = render();
    const original = root.outerHTML;
    const originalSlides = [...track.children];
    const factory = vi.fn((_element: HTMLElement) => ({ destroy: vi.fn(), update: vi.fn() }));
    const controller = create({
      factory,
      enabled: { maxWidth: 767 },
      structure: { equalHeight: true, containInlineSize: true },
      swiper: { slidesPerView: "auto", spaceBetween: 16 },
    });
    viewport(1200);
    controller.init();
    expect(root.outerHTML).toBe(original);
    viewport(640);
    controller.refresh();
    controller.init();
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0]?.[0]).toBe(container);
    expect(container.className).toBe("cards-cms swiper");
    expect(container.style.overflow).toBe("visible");
    expect(container.style.contain).toBe("layout inline-size");
    expect(track.className).toBe("cards-grid swiper-wrapper");
    expect(track.style.display).toBe("flex");
    expect(track.style.flexWrap).toBe("nowrap");
    expect(track.style.gap).toBe("0px");
    expect(track.style.alignItems).toBe("stretch");
    expect(track.children[0]?.className).toBe("card swiper-slide");
    expect((track.children[0] as HTMLElement).style.width).toBe("18rem");
    expect((track.children[0] as HTMLElement).style.flexGrow).toBe("0");
    expect([...track.children]).toEqual(originalSlides);
    viewport(1200);
    controller.refresh();
    expect(root.outerHTML).toBe(original);
    viewport(640);
    controller.refresh();
    expect(factory).toHaveBeenCalledTimes(2);
    controller.destroy();
    expect(root.outerHTML).toBe(original);
  });

  it("supports custom scoped selectors and direct CMS children without slide attributes", () => {
    const { root, track } = render();
    track
      .querySelectorAll("[data-wft-slider-slide]")
      .forEach((slide) => slide.removeAttribute("data-wft-slider-slide"));
    track.insertAdjacentHTML("beforeend", "<template><article>Template</article></template>");
    const controller = create({ structure: { track: ".cards-grid", container: ".cards-cms" } });
    controller.init();
    expect(track.querySelectorAll(":scope > .swiper-slide")).toHaveLength(3);
    expect(track.querySelector("template")?.className).toBe("");
    controller.setOptions({
      structure: { track: ".cards-grid", slides: ":scope > article", layout: false },
    });
    expect(track.style.display).toBe("grid");
    expect(track.classList.contains("swiper-wrapper")).toBe(true);
    controller.destroy();
    expect(root.querySelector(".swiper-slide")).toBeNull();
  });

  it.each([
    ["missing-track", (track: HTMLElement) => track.removeAttribute("data-wft-slider-track")],
    ["missing-slides", (track: HTMLElement) => track.replaceChildren()],
    ["ambiguous-track", (track: HTMLElement) => track.parentElement!.append(track.cloneNode(true))],
    [
      "invalid-container",
      (_track: HTMLElement, root: HTMLElement) =>
        root.setAttribute("data-wft-slider-container", ""),
    ],
    [
      "invalid-slides",
      (track: HTMLElement) => {
        track.children[0]!.innerHTML = "<div data-wft-slider-slide>Inner card</div>";
      },
    ],
  ])("reports %s without mutating invalid markup", (reason, change) => {
    const { root, track } = render();
    change(track, root);
    const original = root.outerHTML;
    const controller = create();
    const issue = vi.fn();
    controller.on("structureIssue", issue);
    controller.init();
    expect(controller.getState().instanceCount).toBe(0);
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ element: root, reason }));
    expect(root.outerHTML).toBe(original);
  });

  it("initializes when delayed track/slides arrive and avoids observing vendor update loops", async () => {
    document.body.innerHTML = "<section data-wft-slider></section>";
    const update = vi.fn(() => {
      document
        .querySelector("[data-wft-slider-pagination]")!
        .replaceChildren(document.createElement("span"));
    });
    const controller = create({
      observeMutations: true,
      factory: () => ({ destroy: vi.fn(), update }),
    });
    controller.init();
    document.querySelector("section")!.innerHTML =
      "<div data-wft-slider-track><article>CMS item</article></div><div data-wft-slider-pagination></div>";
    await vi.waitFor(() => expect(controller.getState().instanceCount).toBe(1));
    update.mockClear();
    const request = vi.spyOn(window, "requestAnimationFrame");
    controller.refresh();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(update).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("prepares new keyed CMS slides before update and rebuilds a replaced track", () => {
    const { root, track } = render();
    const factory = vi.fn((container: HTMLElement) => {
      const instance: SwiperLike = {
        activeIndex: 1,
        slides: container.querySelectorAll(".swiper-slide"),
        destroy: vi.fn(),
        slideTo: vi.fn((index) => {
          instance.activeIndex = index;
        }),
        update() {
          instance.slides = container.querySelectorAll(".swiper-slide");
        },
      };
      return instance;
    });
    const controller = create({ factory });
    controller.init();
    track.insertAdjacentHTML(
      "afterbegin",
      '<article class="new-card" data-wft-slider-slide data-wft-slide-key="new" aria-label="New">New</article>',
    );
    controller.update();
    const added = track.firstElementChild!;
    expect(added.classList.contains("swiper-slide")).toBe(true);
    expect(factory.mock.results[0]?.value.slideTo).toHaveBeenLastCalledWith(2, 0, false);
    const replacement = document.createElement("div");
    replacement.setAttribute("data-wft-slider-track", "");
    replacement.innerHTML =
      '<article data-wft-slider-slide data-wft-slide-key="two">Replacement two</article>';
    track.replaceWith(replacement);
    controller.refresh();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory.mock.results[0]?.value.destroy).toHaveBeenCalledOnce();
    expect(factory.mock.results[1]?.value.slideTo).toHaveBeenLastCalledWith(0, 0, false);
    expect(track.className).toBe("cards-grid");
    expect(added.className).toBe("new-card");
    controller.destroy();
    expect(replacement.className).toBe("");
    expect(root.textContent).toContain("Replacement two");
    expect(root.querySelector(".swiper")).toBeNull();
  });

  it("does not refresh another controller when vendor work changes an unrelated slider", async () => {
    const { root } = render();
    const secondRoot = root.cloneNode(true) as HTMLElement;
    document.body.append(secondRoot);
    const secondUpdate = vi.fn();
    const first = create({
      target: root,
      observeMutations: true,
      factory: () => ({
        destroy: vi.fn(),
        update() {
          root
            .querySelector("[data-wft-slider-pagination]")!
            .replaceChildren(document.createElement("span"));
        },
      }),
    });
    const second = create({
      target: secondRoot,
      observeMutations: true,
      factory: () => ({ destroy: vi.fn(), update: secondUpdate }),
    });
    first.init();
    second.init();
    const request = vi.spyOn(window, "requestAnimationFrame");
    first.refresh();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(request).not.toHaveBeenCalled();
    expect(secondUpdate).not.toHaveBeenCalled();
  });

  it("checks and observes the actual CMS container when the outer root is measurable", () => {
    const { root, container } = render();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
    let visible = false;
    const controller = create({
      deferUntilMeasurable: true,
      isMeasurable: (element) => element === root || visible,
    });
    controller.init();
    expect(controller.getState().instanceCount).toBe(0);
    expect(observe).toHaveBeenCalledWith(container);
    visible = true;
    controller.refresh();
    expect(controller.getState().instanceCount).toBe(1);
  });

  it("checks ownership on both the component and its inner Swiper container", () => {
    const { root, container } = render();
    const first = create();
    first.init();
    const second = create({ target: container, structure: false });
    const conflict = vi.fn();
    second.on("ownershipConflict", conflict);
    second.init();
    expect(second.getState().instanceCount).toBe(0);
    expect(conflict).toHaveBeenCalledWith(
      expect.objectContaining({ element: container, owner: "adapter" }),
    );
    first.destroy();
    const externalContainer = container as HTMLElement & { swiper?: { destroyed: boolean } };
    externalContainer.swiper = { destroyed: false };
    const third = create({ target: root });
    third.on("ownershipConflict", conflict);
    third.init();
    expect(conflict).toHaveBeenLastCalledWith(
      expect.objectContaining({ element: container, owner: "external-swiper" }),
    );
    delete externalContainer.swiper;
  });

  it("keeps nested slider markup and controls under their own owner during outer teardown", () => {
    const { root, track } = render();
    const nested = document.createElement("section");
    nested.setAttribute("data-wft-slider", "");
    nested.innerHTML =
      '<div data-wft-slider-track><div>Inner slide</div></div><button type="button" data-wft-slider-prev>Inner previous</button><button type="button" data-wft-slider-next>Inner next</button>';
    track.children[0]!.prepend(nested);
    const inner = create({ target: nested });
    const outer = create({ target: root });
    inner.init();
    outer.init();
    expect(createWebflowSwiperOptions(root).navigation).toEqual({
      nextEl: root.querySelector(":scope > [data-wft-slider-next]"),
      prevEl: root.querySelector(":scope > [data-wft-slider-prev]"),
    });
    outer.destroy();
    expect(nested.classList.contains("swiper")).toBe(true);
    expect(nested.querySelector(".swiper-slide")).not.toBeNull();
    inner.destroy();
    expect(root.querySelector(".swiper-slide")).toBeNull();
  });

  it("rolls back failed construction, releases ownership, and cleans a partially attached vendor", () => {
    const { root } = render();
    const original = root.outerHTML;
    const destroy = vi.fn();
    const controller = create({
      factory: (container) => {
        const element = container as HTMLElement & { swiper?: SwiperLike };
        element.swiper = {
          destroy: () => {
            destroy();
            delete element.swiper;
          },
          update: vi.fn(),
        };
        container.insertAdjacentHTML("beforeend", '<div class="vendor-created"></div>');
        throw new Error("Failed initialization");
      },
    });
    expect(() => controller.init()).toThrow("Failed initialization");
    expect(destroy).toHaveBeenCalledOnce();
    expect(root.outerHTML).toBe(original);
    const retry = create();
    retry.init();
    expect(retry.getState().instanceCount).toBe(1);
  });

  it.each([
    { wrapperClass: "custom-wrapper" },
    { createElements: true },
    { virtual: { enabled: true } },
    { breakpoints: { 800: { slideClass: "custom-slide" } } },
    { grid: { rows: 2 } },
  ])("rejects conflicting Swiper structure options before mutation: %j", (swiper) => {
    const { root } = render();
    const original = root.outerHTML;
    const controller = create({ swiper });
    expect(() => controller.init()).toThrow();
    expect(root.outerHTML).toBe(original);
  });

  it("runs real Swiper controls, direction changes and CMS updates on authored attribute markup", () => {
    const { root, container, track } = render();
    const original = root.outerHTML;
    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      offsetWidth: { value: 800 },
      clientHeight: { value: 300 },
    });
    let instance: Swiper;
    const beforeInit = vi.fn();
    const changeDirection = vi.fn();
    const controller = create({
      factory: (element, options) => {
        instance = new Swiper(element, options);
        return instance;
      },
      swiper: (element) =>
        createWebflowSwiperOptions(element, {
          swiper: {
            speed: 0,
            watchOverflow: false,
            slidesPerView: 1,
            on: { beforeInit, changeDirection },
          },
        }),
    });
    controller.init();
    expect(instance!.el).toBe(container);
    expect(instance!.wrapperEl).toBe(track);
    expect(instance!.slides).toHaveLength(3);
    expect(track.hasAttribute("role")).toBe(false);
    expect(instance!.slides[0]?.getAttribute("role")).toBe("group");
    expect(beforeInit).toHaveBeenCalledOnce();
    root.querySelector<HTMLButtonElement>("[data-wft-slider-next]")!.click();
    expect(instance!.activeIndex).toBe(1);
    instance!.changeDirection("vertical");
    expect(track.style.flexDirection).toBe("column");
    expect(changeDirection).toHaveBeenCalledOnce();
    track.insertAdjacentHTML(
      "beforeend",
      '<article class="card" data-wft-slider-slide data-wft-slide-key="four">Four</article>',
    );
    controller.refresh();
    expect(instance!.slides).toHaveLength(4);
    controller.destroy();
    const added = root.querySelector('[data-wft-slide-key="four"]')!;
    expect(added.className).toBe("card");
    expect(added.hasAttribute("style")).toBe(false);
    added.remove();
    expect(root.outerHTML).toBe(original);
  });
});
