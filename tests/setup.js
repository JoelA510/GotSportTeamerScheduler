import '@testing-library/jest-dom';

// jsdom lacks ResizeObserver; @dnd-kit relies on it.
globalThis.ResizeObserver =
  globalThis.ResizeObserver ||
  class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };

// jsdom lacks IntersectionObserver.
globalThis.IntersectionObserver =
  globalThis.IntersectionObserver ||
  class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };

// jsdom doesn't always stub scrollIntoView on Element.prototype.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
