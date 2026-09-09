import { afterEach, describe, expect, it, vi } from 'vitest';

import { revealStepDetail, type StepActivation } from './agent-map-scroll';

type MockElement = HTMLElement & {
  focus: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
  scrollTo: ReturnType<typeof vi.fn>;
};

function element(top: number, bottom: number, scrollHeight = bottom - top, clientHeight = bottom - top): MockElement {
  const target = {
    scrollTop: 0,
    scrollHeight,
    clientHeight,
    focus: vi.fn(),
    scrollIntoView: vi.fn(),
    getBoundingClientRect: () =>
      ({
        top,
        bottom,
        left: 0,
        right: 900,
        width: 900,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect,
  } as unknown as MockElement;
  target.scrollTo = vi.fn((options: ScrollToOptions) => {
    target.scrollTop = options.top ?? target.scrollTop;
  });
  return target;
}

afterEach(() => vi.unstubAllGlobals());

describe('legacy step-detail scrolling', () => {
  it('moves only its supplied internal container', () => {
    const windowScroll = vi.fn();
    vi.stubGlobal('window', { scroll: windowScroll, scrollTo: windowScroll });
    const container = element(100, 500, 1800, 400);
    const heading = element(720, 760);
    const activation: StepActivation = { stepId: 'step-14', kind: 'pointer', sequence: 1 };
    expect(
      revealStepDetail({
        activation,
        selectedStepId: 'step-14',
        container,
        heading,
        reducedMotion: false,
      })
    ).toEqual({ focused: false, scrolled: true, top: 260 });
    expect(windowScroll).not.toHaveBeenCalled();
    expect(heading.scrollIntoView).not.toHaveBeenCalled();
  });

  it('uses non-animated movement for reduced motion', () => {
    const container = element(0, 320, 2200, 320);
    const heading = element(900, 940);
    revealStepDetail({
      activation: { stepId: 'step-18', kind: 'pointer', sequence: 1 },
      selectedStepId: 'step-18',
      container,
      heading,
      reducedMotion: true,
    });
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 620, behavior: 'auto' });
  });
});
