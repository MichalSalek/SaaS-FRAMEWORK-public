import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InputAtom } from './Input.atom';

describe('InputAtom suffix descriptions', () => {
  it('keeps numeric value and combines caller, error and unit descriptions', () => {
    render(
      <>
        <p id='help'>Help</p>
        <InputAtom
          id='minutes'
          label='Time'
          type='number'
          defaultValue={10}
          suffix='minut'
          error='Invalid'
          aria-describedby='help minutes-error'
        />
      </>
    );
    const input = screen.getByRole('spinbutton', { name: 'Time' });
    expect(input).toHaveValue(10);
    expect(input).toHaveAttribute(
      'aria-describedby',
      'help minutes-error minutes-unit'
    );
    expect(input).toHaveAccessibleDescription('Help Invalid minut');
    expect(screen.getByText('minut')).toHaveAttribute('id', 'minutes-unit');
  });

  it('preserves caller descriptions for a textarea and ordinary field', () => {
    render(
      <>
        <InputAtom label='Text' aria-describedby='plain-help' />
        <InputAtom
          label='Note'
          multiline
          error='Error'
          aria-describedby='note-help'
          id='note'
        />
      </>
    );
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveAttribute(
      'aria-describedby',
      'plain-help'
    );
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute(
      'aria-describedby',
      'note-help note-error'
    );
    expect(screen.queryByText('minut')).not.toBeInTheDocument();
  });
});
