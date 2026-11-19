import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExternalLinksFieldMolecule } from './ExternalLinksField.molecule';

const labels = {
  title: 'Linki',
  hint: 'Dodaj link',
  inputLabel: 'Link',
  add: 'Dodaj kolejny link',
  remove: 'Usuń link',
  invalid: 'Nieprawidłowy adres',
};

describe('ExternalLinksFieldMolecule', () => {
  it('commits the last pasted link even when blur lands in the same batch', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <ExternalLinksFieldMolecule
        value={[]}
        onChange={onChange}
        onCommit={onCommit}
        labels={labels}
      />
    );
    const input = screen.getByRole('textbox', { name: 'Link 1' });
    fireEvent.change(input, {
      target: { value: 'https://www.fresha.com/a/qa-test' },
    });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(['https://www.fresha.com/a/qa-test']);
  });
});
