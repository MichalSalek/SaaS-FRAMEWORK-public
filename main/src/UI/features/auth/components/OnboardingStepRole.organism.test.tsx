import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { FormProvider, useForm } from 'react-hook-form';
import messages from '../../../../locales/pl/common.json';
import {
  ONBOARDING_DEFAULTS,
  type OnboardingFormValues,
} from '../onboarding.types';
import { stylistOnboardPayload } from '../OnboardingPage.parts.helpers';
import { OnboardingStepRoleOrganism } from './OnboardingStepRole.organism';

afterEach(cleanup);

const label = messages.pages.onboarding.marketingConsentLabel;
const roleName = (role: 'stylist' | 'client') =>
  new RegExp(
    messages.pages.onboarding[
      role === 'stylist' ? 'stylistRoleTitle' : 'clientRoleTitle'
    ]
  );

function Harness({
  initial = false,
  disabled = false,
  onSubmit = () => undefined,
}: {
  initial?: boolean;
  disabled?: boolean;
  onSubmit?: (payload: ReturnType<typeof stylistOnboardPayload>) => void;
}) {
  const methods = useForm<OnboardingFormValues>({
    defaultValues: {
      ...ONBOARDING_DEFAULTS,
      role: 'stylist',
      email_marketing: initial,
    },
  });
  return (
    <NextIntlClientProvider locale='pl' messages={messages}>
      <FormProvider {...methods}>
        <form
          onSubmit={event =>
            void methods.handleSubmit(values =>
              onSubmit(stylistOnboardPayload('Anna', values.email_marketing))
            )(event)
          }>
          <OnboardingStepRoleOrganism disabled={disabled} />
          <button type='submit'>Zapisz</button>
        </form>
      </FormProvider>
    </NextIntlClientProvider>
  );
}

describe('registration marketing choice', () => {
  it('allows creating the account without opting into email', async () => {
    const save = vi.fn();
    render(<Harness onSubmit={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ email_marketing: false })
      )
    );
  });

  it('starts off for a new stylist and submits the explicitly selected opt-in', async () => {
    const save = vi.fn();
    render(<Harness onSubmit={save} />);
    const checkbox = screen.getByRole('checkbox', { name: label });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ email_marketing: true })
      )
    );
  });

  it('keeps an existing opt-in unless the stylist explicitly turns it off', async () => {
    const save = vi.fn();
    render(<Harness initial onSubmit={save} />);
    expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ email_marketing: true })
      )
    );
    fireEvent.click(screen.getByRole('checkbox', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ email_marketing: false })
      )
    );
  });

  it('keeps the draft when changing roles and offers no unsupported client preference', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox', { name: label }));
    fireEvent.click(screen.getByRole('radio', { name: roleName('client') }));
    expect(
      screen.queryByRole('checkbox', { name: label })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: roleName('stylist') }));
    expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
  });

  it('locks the choice while submitting so the visible consent matches the request', () => {
    render(<Harness disabled />);
    expect(screen.getByRole('checkbox', { name: label })).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: roleName('client') })
    ).toBeDisabled();
  });
});
