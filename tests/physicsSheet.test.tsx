import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhysicsBottomSheet } from '../src/components/Common/PhysicsBottomSheet';

function dispatchPointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientY: number,
  pointerId = 1
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
    button: 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: pointerId });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  fireEvent(target, ev);
}

// jsdom does not implement layout, so mock offsetHeight on the sheet body
function mockBodyHeight(bodyEl: HTMLElement, heightPx: number) {
  Object.defineProperty(bodyEl, 'offsetHeight', {
    configurable: true,
    value: heightPx,
  });
}

describe('PhysicsBottomSheet: Feder-Physik & Drag-Interaktion', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('wendet niemals cmf-sheet-up direkt auf sheetRef an und verschiebt das Menü 1:1 beim Ziehen', () => {
    const onChangeSpy = vi.fn();
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <PhysicsBottomSheet
          collapsed={collapsed}
          onCollapsedChange={(next) => {
            onChangeSpy(next);
            setCollapsed(next);
          }}
          handleTestId="test-sheet-handle"
          allowBodyDrag
          header={<span>Header</span>}
        >
          <div data-testid="sheet-body-inner">Body Content</div>
        </PhysicsBottomSheet>
      );
    }

    render(<Harness />);
    const surface = screen.getByTestId('physics-sheet-surface');
    const handle = screen.getByTestId('test-sheet-handle');
    const bodyEl = screen.getByTestId('sheet-body-inner')
      .parentElement as HTMLElement;

    // Kritischer Fix: sheetRef darf NICHT cmf-sheet-up tragen (würde inline transform via forwards blockieren!)
    expect(surface.className).not.toContain('cmf-sheet-up');

    mockBodyHeight(bodyEl, 300);

    dispatchPointer(handle, 'pointerdown', 400, 1);
    dispatchPointer(handle, 'pointermove', 520, 1);

    expect(surface.style.transform).toBe('translate3d(0, 120.00px, 0)');

    // Weiter nach unten über 44% Schwelle ziehen -> klappt ein
    dispatchPointer(handle, 'pointermove', 580, 1);
    expect(surface.style.transform).toBe('translate3d(0, 180.00px, 0)');

    dispatchPointer(handle, 'pointerup', 580, 1);
    expect(onChangeSpy).toHaveBeenCalledWith(true);
  });

  it('erlaubt Ziehen nach oben mit Gummi-Widerstand (Rubber-Banding)', () => {
    render(
      <PhysicsBottomSheet
        collapsed={false}
        onCollapsedChange={vi.fn()}
        handleTestId="rubber-handle"
        header={<span>Titel</span>}
      >
        <div data-testid="rubber-body">Inhalt</div>
      </PhysicsBottomSheet>
    );

    const surface = screen.getByTestId('physics-sheet-surface');
    const handle = screen.getByTestId('rubber-handle');
    const bodyEl = screen.getByTestId('rubber-body')
      .parentElement as HTMLElement;
    mockBodyHeight(bodyEl, 300);

    dispatchPointer(handle, 'pointerdown', 400, 3);
    dispatchPointer(handle, 'pointermove', 340, 3); // 60px über oberen Anschlag ziehen

    // Muss negativ sein (nach oben gedehnt), aber durch Rubber-Banding gedämpft (< 34px)
    const match = surface.style.transform.match(/translate3d\(0,\s*(-?\d+(\.\d+)?)px/);
    expect(match).not.toBeNull();
    const y = Number(match![1]);
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-34);
  });

  it('klappt beim Tap auf das Handle zwischen offen und eingeklappt um', () => {
    const onCollapsedChange = vi.fn();
    render(
      <PhysicsBottomSheet
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        handleTestId="tap-handle"
        header={<span>Titel</span>}
      >
        <div>Inhalt</div>
      </PhysicsBottomSheet>
    );

    const handle = screen.getByTestId('tap-handle');
    dispatchPointer(handle, 'pointerdown', 300, 2);
    dispatchPointer(handle, 'pointerup', 301, 2);

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});
