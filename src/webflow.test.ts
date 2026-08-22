import { afterEach, describe, expect, it } from "vitest";

import { createWebflowSwiperOptions } from "./webflow.js";

afterEach(() => {
  document.body.replaceChildren();
});

function renderSlider(): HTMLElement {
  document.body.innerHTML = `
    <section class="swiper" data-wft-slider>
      <div class="swiper-wrapper">
        <article class="swiper-slide" data-wft-slide-key="one"></article>
        <article class="swiper-slide" data-wft-slide-key="two"></article>
      </div>
      <button type="button" data-wft-slider-prev></button>
      <button type="button" data-wft-slider-next></button>
      <div data-wft-slider-pagination></div>
    </section>
  `;
  return document.querySelector<HTMLElement>("[data-wft-slider]")!;
}

describe("opt-in Webflow Swiper options", () => {
  it("scopes upstream modules and accessible controls to one slider root", () => {
    const root = renderSlider();
    const options = createWebflowSwiperOptions(root, {
      navigation: { previousLabel: "Previous item", nextLabel: "Next item" },
      swiper: { slidesPerView: 1.2, spaceBetween: 16 },
    });
    const previous = root.querySelector<HTMLButtonElement>("[data-wft-slider-prev]")!;
    const next = root.querySelector<HTMLButtonElement>("[data-wft-slider-next]")!;

    expect(options.modules).toHaveLength(3);
    expect(options.a11y).toEqual(expect.objectContaining({ enabled: true }));
    expect(options.navigation).toEqual({ prevEl: previous, nextEl: next });
    expect(options.pagination).toEqual({
      clickable: true,
      el: root.querySelector("[data-wft-slider-pagination]"),
    });
    expect(options.slidesPerView).toBe(1.2);
    expect(previous.hasAttribute("aria-label")).toBe(false);
    expect(next.hasAttribute("aria-label")).toBe(false);
    expect(previous.type).toBe("button");
    expect(root.classList.contains("swiper-initialized")).toBe(false);
  });

  it("accepts author-provided button names without replacing them", () => {
    const root = renderSlider();
    const previous = root.querySelector<HTMLButtonElement>("[data-wft-slider-prev]")!;
    const next = root.querySelector<HTMLButtonElement>("[data-wft-slider-next]")!;
    previous.setAttribute("aria-label", "Back");
    next.textContent = "Forward";

    createWebflowSwiperOptions(root);
    expect(previous.getAttribute("aria-label")).toBe("Back");
    expect(next.hasAttribute("aria-label")).toBe(false);
  });

  it("rejects unnamed or incomplete navigation without partial mutation", () => {
    const root = renderSlider();
    const previous = root.querySelector<HTMLButtonElement>("[data-wft-slider-prev]")!;
    expect(() => createWebflowSwiperOptions(root)).toThrow("needs an accessible name");
    expect(previous.getAttribute("type")).toBe("button");
    expect(previous.hasAttribute("aria-label")).toBe(false);

    root.querySelector("[data-wft-slider-next]")?.remove();
    expect(() =>
      createWebflowSwiperOptions(root, {
        navigation: { previousLabel: "Previous", nextLabel: "Next" },
      }),
    ).toThrow("requires both previous and next controls");
  });

  it("rejects navigation buttons that could submit a surrounding form", () => {
    const root = renderSlider();
    root.querySelector("[data-wft-slider-prev]")?.removeAttribute("type");

    expect(() =>
      createWebflowSwiperOptions(root, {
        navigation: { previousLabel: "Previous", nextLabel: "Next" },
      }),
    ).toThrow('must use type="button"');
  });

  it("can opt out of navigation, pagination, and A11y modules", () => {
    const root = renderSlider();
    const options = createWebflowSwiperOptions(root, {
      a11y: false,
      navigation: false,
      pagination: false,
    });

    expect(options.modules).toEqual([]);
    expect(options.a11y).toBe(false);
    expect(options.navigation).toBeUndefined();
    expect(options.pagination).toBeUndefined();
  });
});
