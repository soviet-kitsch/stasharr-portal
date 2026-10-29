import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FullscreenService } from './fullscreen.service';

describe('mobile fullscreen orientation', () => {
  afterEach(() => TestBed.resetTestingModule());
  function setup(mobile = true) {
    const doc: any = {
      fullscreenElement: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      documentElement: {},
      defaultView: {
        navigator: { maxTouchPoints: mobile ? 1 : 0 },
        matchMedia: () => ({ matches: mobile }),
        screen: {
          width: mobile ? 390 : 1600,
          height: mobile ? 844 : 1000,
          orientation: { lock: vi.fn().mockResolvedValue(undefined), unlock: vi.fn() },
        },
      },
    };
    doc.documentElement.requestFullscreen = vi.fn(async () => {
      doc.fullscreenElement = doc.documentElement;
    });
    doc.exitFullscreen = vi.fn(async () => {
      doc.fullscreenElement = null;
    });
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: doc }] });
    return {
      doc,
      service: TestBed.inject(FullscreenService),
      orientation: doc.defaultView.screen.orientation,
    };
  }
  it('enters fullscreen before requesting landscape on touch devices', async () => {
    const { doc, service, orientation } = setup();
    await service.toggle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(orientation.lock).toHaveBeenCalledWith('landscape');
    expect(service.active()).toBe(true);
    expect(doc.documentElement.requestFullscreen.mock.invocationCallOrder[0]).toBeLessThan(
      orientation.lock.mock.invocationCallOrder[0],
    );
  });
  it('does not lock desktop orientation', async () => {
    const { service, orientation } = setup(false);
    await service.toggle();
    expect(orientation.lock).not.toHaveBeenCalled();
  });
  it('unlocks only its own successful lock on exit', async () => {
    const { doc, service, orientation } = setup();
    await service.toggle();
    await service.toggle();
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    expect(orientation.unlock).toHaveBeenCalledOnce();
    expect(service.active()).toBe(false);
  });
  it('handles orientation denial while keeping fullscreen usable', async () => {
    const { service, orientation } = setup();
    orientation.lock.mockRejectedValue(new Error('not allowed'));
    await service.toggle();
    expect(service.active()).toBe(true);
    expect(service.message()).toContain('Rotate your device');
    await service.toggle();
    expect(orientation.unlock).not.toHaveBeenCalled();
  });
  it('handles unsupported fullscreen without trying to lock orientation', async () => {
    const { doc, service, orientation } = setup();
    delete doc.documentElement.requestFullscreen;
    await service.toggle();
    expect(service.message()).toContain('not available');
    expect(orientation.lock).not.toHaveBeenCalled();
  });
  it('releases landscape when the browser exits fullscreen itself', async () => {
    const { doc, service, orientation } = setup();
    await service.toggle();
    doc.fullscreenElement = null;
    doc.addEventListener.mock.calls[0][1]();
    expect(service.active()).toBe(false);
    expect(orientation.unlock).toHaveBeenCalledOnce();
  });
  it('releases a late lock if fullscreen exits while the lock is pending', async () => {
    const { doc, service, orientation } = setup();
    let resolve: () => void = () => {};
    orientation.lock.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const pending = service.toggle();
    await Promise.resolve();
    doc.fullscreenElement = null;
    doc.addEventListener.mock.calls[0][1]();
    resolve();
    await pending;
    expect(orientation.unlock).toHaveBeenCalledOnce();
    expect(service.active()).toBe(false);
  });
});
