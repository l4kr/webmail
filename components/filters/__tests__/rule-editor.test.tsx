import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { FilterRule } from '@/lib/jmap/sieve-types';
import { RuleEditor } from '../rule-editor';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function existing(overrides: Partial<FilterRule> = {}): FilterRule {
  return {
    id: 'rule-1',
    name: 'Statements',
    enabled: true,
    matchType: 'all',
    conditions: [{ field: 'from', comparator: 'contains', value: 'revolut.com' }],
    actions: [{ type: 'mark_read' }],
    stopProcessing: false,
    ...overrides,
  };
}

describe('RuleEditor', () => {
  it('makes a rule from ticked actions and names it after what it does when the name is left empty', () => {
    const onSave = vi.fn();
    render(<RuleEditor mailboxes={[]} onSave={onSave} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('condition_value'), { target: { value: 'news@acme.com' } });
    fireEvent.click(screen.getByLabelText('action_types.mark_read'));
    fireEvent.click(screen.getByLabelText('action_types.star'));
    fireEvent.click(screen.getByText('save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: FilterRule = onSave.mock.calls[0][0];
    expect(saved.actions).toEqual([{ type: 'mark_read' }, { type: 'star' }]);
    expect(saved.conditions).toEqual([{ field: 'from', comparator: 'contains', value: 'news@acme.com' }]);
    expect(saved.name).toBe('condition_fields.from news@acme.com → action_types.mark_read, action_types.star');
  });

  it('opens a rule with its actions ticked', () => {
    render(<RuleEditor rule={existing({ actions: [{ type: 'star' }] })} mailboxes={[]} onSave={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText('action_types.star') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('action_types.mark_read') as HTMLInputElement).checked).toBe(false);
  });

  it('does not let a deleting rule also move the message', () => {
    render(<RuleEditor rule={existing({ actions: [{ type: 'discard' }] })} mailboxes={[]} onSave={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText('action_types.move') as HTMLInputElement).disabled).toBe(true);
  });

  it('stops later rules when "Continue to apply other rules" is unticked, and can skip the rule', () => {
    const onSave = vi.fn();
    render(<RuleEditor rule={existing()} mailboxes={[]} onSave={onSave} onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText('Continue to apply other rules'));
    fireEvent.click(screen.getByLabelText('Skip this rule'));
    fireEvent.click(screen.getByText('save'));

    expect(onSave.mock.calls[0][0]).toMatchObject({ stopProcessing: true, enabled: false, name: 'Statements' });
  });

  it('offers "Has an attachment" as a condition of its own, without a comparison', () => {
    const onSave = vi.fn();
    render(<RuleEditor rule={existing()} mailboxes={[]} onSave={onSave} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Condition 1'), { target: { value: 'attachment_any' } });
    expect(screen.queryByLabelText('condition_value')).toBeNull();
    fireEvent.click(screen.getByText('save'));

    expect(onSave.mock.calls[0][0].conditions).toEqual([{ field: 'attachment', comparator: 'has_any', value: '' }]);
  });

  it('shows the mail the rule would catch while the conditions are typed', async () => {
    const previewMatches = vi.fn().mockResolvedValue({
      items: [{ id: 'm1', from: 'Revolut', subject: 'Your account statement is available', receivedAt: '2026-11-03T00:00:00Z' }],
      total: 1,
      complete: true,
    });
    render(<RuleEditor rule={existing()} mailboxes={[]} previewMatches={previewMatches} onSave={() => {}} onClose={() => {}} />);

    const summary = await screen.findByText('1 message matches', {}, { timeout: 3000 });
    expect(previewMatches.mock.calls[0][0].conditions).toEqual([{ field: 'from', comparator: 'contains', value: 'revolut.com' }]);
    fireEvent.click(summary);
    await waitFor(() => expect(screen.getByText('Your account statement is available')).toBeTruthy());
  });

  it('offers to also apply the rule to the Inbox or to all mail, saying how many messages each covers', async () => {
    const onSave = vi.fn();
    const previewMatches = vi.fn().mockResolvedValue({ items: [], total: 7, complete: true, inFolder: 3 });
    render(
      <RuleEditor rule={existing()} mailboxes={[]} previewMatches={previewMatches} offerApplyToExisting applyExistingFolder="Inbox" onSave={onSave} onClose={() => {}} />,
    );

    const choice = (await screen.findByLabelText('Apply to', {}, { timeout: 3000 })) as HTMLSelectElement;
    expect([...choice.options].map((o) => o.textContent)).toEqual(['New mail only', 'New mail and Inbox (3)', 'New mail and all mail (7)']);
    expect(choice.value).toBe('new');
    fireEvent.change(choice, { target: { value: 'all' } });
    fireEvent.click(screen.getByText('save'));

    expect(onSave.mock.calls[0][1]).toEqual({ applyTo: 'all' });
  });

  it('marks a count as a lower bound when not all mail was looked at', async () => {
    const previewMatches = vi.fn().mockResolvedValue({ items: [], total: 1000, complete: false, inFolder: 40 });
    render(
      <RuleEditor rule={existing()} mailboxes={[]} previewMatches={previewMatches} offerApplyToExisting applyExistingFolder="Inbox" onSave={() => {}} onClose={() => {}} />,
    );
    const choice = (await screen.findByLabelText('Apply to', {}, { timeout: 3000 })) as HTMLSelectElement;
    expect([...choice.options].map((o) => o.textContent)).toEqual(['New mail only', 'New mail and Inbox (40+)', 'New mail and all mail (1000+)']);
  });

  it('does not offer to apply a rule that only forwards, so old mail is never sent on', async () => {
    const previewMatches = vi.fn().mockResolvedValue({ items: [], total: 7, complete: true, inFolder: 3 });
    render(
      <RuleEditor
        rule={existing({ actions: [{ type: 'forward', value: 'me@elsewhere.example' }] })}
        mailboxes={[]}
        previewMatches={previewMatches}
        offerApplyToExisting
        applyExistingFolder="Inbox"
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    await screen.findByText('7 messages match', {}, { timeout: 3000 });
    expect(screen.queryByLabelText('Apply to')).toBeNull();
  });

  it('treats a value of only commas as empty instead of saving a rule the server rejects', () => {
    const onSave = vi.fn();
    render(<RuleEditor mailboxes={[]} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('condition_value'), { target: { value: ' , ,' } });
    fireEvent.click(screen.getByLabelText('action_types.star'));
    fireEvent.click(screen.getByText('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('validation_empty_conditions');
  });

  it('refuses an attachment type that names no extension, which the server would reject', () => {
    const onSave = vi.fn();
    render(<RuleEditor rule={existing()} mailboxes={[]} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Condition 1'), { target: { value: 'attachment_type' } });
    fireEvent.change(screen.getByLabelText('condition_value'), { target: { value: '.*' } });
    fireEvent.click(screen.getByText('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Enter a file extension, such as pdf');
  });

  it('asks to untick one of two contradicting actions carried over from an older rule', () => {
    const onSave = vi.fn();
    render(
      <RuleEditor
        rule={existing({ actions: [{ type: 'move', value: 'News', mailboxId: 'news' }, { type: 'discard' }] })}
        mailboxes={[{ id: 'news', name: 'News', role: null } as never]}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Delete and Reject cannot be combined with Move, Copy or Keep, or with each other');
    fireEvent.click(screen.getByLabelText('action_types.discard'));
    fireEvent.click(screen.getByText('save'));
    expect(onSave.mock.calls[0][0].actions).toEqual([{ type: 'move', value: 'News', mailboxId: 'news' }]);
  });

  it('says only recent mail was looked at, and still offers applying, when the scan stopped early', async () => {
    const previewMatches = vi.fn().mockResolvedValue({ items: [], total: 0, complete: false, inFolder: 0 });
    render(
      <RuleEditor rule={existing()} mailboxes={[]} previewMatches={previewMatches} offerApplyToExisting applyExistingFolder="Inbox" onSave={() => {}} onClose={() => {}} />,
    );
    await screen.findByText('No recent messages match', {}, { timeout: 3000 });
    const choice = screen.getByLabelText('Apply to') as HTMLSelectElement;
    expect([...choice.options].map((o) => o.textContent)).toEqual(['New mail only', 'New mail and Inbox', 'New mail and all mail']);
  });

  it('only offers "contains" for the message text, since that is the test the server runs', () => {
    render(<RuleEditor rule={existing()} mailboxes={[]} onSave={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Condition 1'), { target: { value: 'body' } });
    const comparator = screen.getByLabelText('comparators.contains') as HTMLSelectElement;
    expect([...comparator.options].map((o) => o.value)).toEqual(['contains']);
  });

  it('says what is missing instead of saving an empty rule', () => {
    const onSave = vi.fn();
    render(<RuleEditor mailboxes={[]} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('condition_value'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('validation_empty_actions');
  });
});
