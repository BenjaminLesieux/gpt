import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/lib/i18n';
import { DiffTrackTabs } from './DiffTrackTabs';

const tracks = [
  { name: 'Guitar', changes: 0 },
  { name: 'Bass', changes: 3 },
];

function renderTabs(props: Partial<Parameters<typeof DiffTrackTabs>[0]> = {}) {
  return render(
    <DiffTrackTabs
      tracks={tracks}
      totalChanges={3}
      value={null}
      onChange={vi.fn()}
      {...props}
    />,
  );
}

beforeAll(() => i18n.changeLanguage('en'));

describe('DiffTrackTabs', () => {
  it('leads with All, then the instruments', () => {
    renderTabs();

    const labels = screen.getAllByRole('button').map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual([
      'All tracks — 3 bars with changes',
      'Guitar — no change',
      'Bass — 3 bars with changes',
    ]);
  });

  it('chips the tracks the edit touched, and leaves the others bare', () => {
    renderTabs();

    // One chip for All, one for the bass — the untouched guitar has none.
    expect(screen.getAllByText('3')).toHaveLength(2);
  });

  it('narrows to a track by its index, and back to All', async () => {
    const onChange = vi.fn();
    renderTabs({ onChange });

    await userEvent.click(screen.getByLabelText(/^Bass/));
    expect(onChange).toHaveBeenCalledWith(1);

    renderTabs({ value: 1, onChange });
    await userEvent.click(screen.getAllByLabelText(/^All tracks/)[1]!);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps the selection when the active tab is clicked again', async () => {
    const onChange = vi.fn();
    renderTabs({ onChange });

    await userEvent.click(screen.getByLabelText(/^All tracks/));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders nothing for a single-track score, where All is that track', () => {
    const { container } = renderTabs({ tracks: [{ name: 'Guitar', changes: 2 }] });

    expect(container.firstChild).toBeNull();
  });
});
