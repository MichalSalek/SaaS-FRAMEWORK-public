/**
 * accountSetAvatar_IO — kontrakt zdjęcia profilowego stylistki.
 *
 * Zamykamy cztery rzeczy, których typy nie pilnują:
 *  - ustawienie zdjęcia zapisuje kolumnę i sprząta POPRZEDNI plik z chmury;
 *  - zapis jest WARUNKOWY (compare-and-set): przegrana z równoległym zapisem
 *    powtarza odczyt, żeby wartość oddana do skasowania była tą realnie wypartą;
 *  - `null` czyści kolumnę (powrót do fallbacku OAuth/inicjałów) i też sprząta;
 *  - ta sama wartość co obecna = ZERO zapisu i ZERO sprzątania (inaczej „poprzedni"
 *    byłby adresem żywego avatara i kasowalibyśmy go użytkowniczce sprzed nosa);
 *  - adres wskazujący na plik INNEGO konta jest odrzucany, zanim cokolwiek zapiszemy
 *    (przywłaszczenie wizerunku + wektor skasowania cudzego pliku przy podmianie).
 */

import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  accountSetAvatar_IO,
  collectStylistAvatarUrlsForUser_IO,
} from './account-avatar.operations';
import { cleanupCloudinaryAsset } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';

vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAsset: vi.fn(),
  cleanupCloudinaryAssets: vi.fn(),
}));

vi.mock('@domain/_shared/guards/cloudinary-asset.guard', () => ({
  findForeignAssetOwner: vi.fn(async () => 'OWN'),
}));

const ACCOUNT_ID = 'acc_test_0000000000000001';
const USER_ID = 'usr_test_0000000000000001';
const NEW_URL =
  'https://res.cloudinary.com/test/image/upload/v1/nailfolio/new-face.jpg';
const OLD_URL =
  'https://res.cloudinary.com/test/image/upload/v1/nailfolio/old-face.jpg';
const OTHER_URL =
  'https://res.cloudinary.com/test/image/upload/v1/nailfolio/race-face.jpg';

/**
 * @param reads - kolejne wyniki odczytu `avatar_url` (jeden na obrót pętli CAS).
 * @param casCounts - kolejne wyniki warunkowego zapisu; 0 = przegrana z równoległym
 *   zapisem, co ma wymusić ponowny odczyt.
 */
const mockScenario = (
  reads: Array<string | null>,
  casCounts: number[] = [1]
) => {
  let readIndex = 0;
  let casIndex = 0;
  const findUnique = vi.fn(async () => ({
    avatar_url: reads[Math.min(readIndex++, reads.length - 1)] ?? null,
  }));
  const updateMany = vi.fn(async (_arg: unknown) => ({
    count: casCounts[Math.min(casIndex++, casCounts.length - 1)] ?? 1,
  }));
  mockDb({ stylistAccount: { findUnique, updateMany } });
  return { findUnique, updateMany };
};

describe('accountSetAvatar_IO', () => {
  it('zapisuje nowy adres i sprząta poprzedni plik', async () => {
    vi.mocked(cleanupCloudinaryAsset).mockClear();
    const { updateMany } = mockScenario([OLD_URL]);

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: NEW_URL,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        account_id: ACCOUNT_ID,
        avatar_url: NEW_URL,
      });
    }
    expect(updateMany).toHaveBeenCalledTimes(1);
    // Bramka compare-and-set: zapis wchodzi TYLKO gdy kolumna wciąż trzyma
    // wartość, którą przeczytaliśmy.
    const casArg = updateMany.mock.calls[0]?.[0] as unknown as {
      where: { account_id: string; avatar_url: string | null };
      data: { avatar_url: string | null };
    };
    expect(casArg.where.avatar_url).toBe(OLD_URL);
    expect(casArg.data.avatar_url).toBe(NEW_URL);
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(OLD_URL);
  });

  it('przegrana z równoległym zapisem: ponowny odczyt, sprzątamy REALNIE wypartą wartość', async () => {
    vi.mocked(cleanupCloudinaryAsset).mockClear();
    // Pierwszy obrót czyta OLD_URL i przegrywa (count 0), bo ktoś zdążył zapisać
    // OTHER_URL; drugi obrót czyta OTHER_URL i wygrywa.
    const { findUnique, updateMany } = mockScenario(
      [OLD_URL, OTHER_URL],
      [0, 1]
    );

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: NEW_URL,
    });

    expect(result.success).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    // Kasujemy OTHER_URL (to on został wyparty), NIE OLD_URL z pierwszego odczytu.
    expect(cleanupCloudinaryAsset).toHaveBeenCalledTimes(1);
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(OTHER_URL);
  });

  it('trzy przegrane próby z rzędu → błąd, zero cichego sprzątania', async () => {
    vi.mocked(cleanupCloudinaryAsset).mockClear();
    mockScenario([OLD_URL], [0]);

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: NEW_URL,
    });

    expect(result.success).toBe(false);
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });

  it('null czyści kolumnę i sprząta plik (powrót do fallbacku)', async () => {
    vi.mocked(cleanupCloudinaryAsset).mockClear();
    const { updateMany } = mockScenario([OLD_URL]);

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avatar_url).toBeNull();
    }
    const casArg = updateMany.mock.calls[0]?.[0] as unknown as {
      data: { avatar_url: string | null };
    };
    expect(casArg.data.avatar_url).toBeNull();
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(OLD_URL);
  });

  it('ta sama wartość: brak zapisu i brak kasowania żywego pliku', async () => {
    vi.mocked(cleanupCloudinaryAsset).mockClear();
    const { updateMany } = mockScenario([NEW_URL]);

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: NEW_URL,
    });

    expect(result.success).toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });

  it('brak konta → ACCOUNT_NOT_FOUND, nic nie zapisujemy', async () => {
    const findUnique = vi.fn(async () => null);
    const updateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    mockDb({ stylistAccount: { findUnique, updateMany } });

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: NEW_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('cudzy plik → VALIDATION_ERROR jeszcze przed dotknięciem bazy', async () => {
    vi.mocked(findForeignAssetOwner).mockResolvedValueOnce('FOREIGN');
    const { findUnique, updateMany } = mockScenario([null]);

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: NEW_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('nierozpoznany adres pliku też jest odrzucany (fail-closed)', async () => {
    vi.mocked(findForeignAssetOwner).mockResolvedValueOnce('UNRECOGNIZED_URL');
    const { updateMany } = mockScenario([null]);

    const result = await accountSetAvatar_IO({
      account_id: ACCOUNT_ID,
      avatar_url: NEW_URL,
    });

    expect(result.success).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('czyszczenie NIE przechodzi przez bramkę własności (null nie ma pliku)', async () => {
    vi.mocked(findForeignAssetOwner).mockClear();
    mockScenario([OLD_URL]);

    await accountSetAvatar_IO({ account_id: ACCOUNT_ID, avatar_url: null });

    expect(findForeignAssetOwner).not.toHaveBeenCalled();
  });
});

describe('collectStylistAvatarUrlsForUser_IO', () => {
  it('zbiera adresy avatarów konta przed terminalnym usunięciem', async () => {
    mockDb({
      stylistAccount: { findMany: async () => [{ avatar_url: OLD_URL }] },
    });

    await expect(collectStylistAvatarUrlsForUser_IO(USER_ID)).resolves.toEqual([
      OLD_URL,
    ]);
  });

  it('błąd bazy nie blokuje usunięcia konta (pusta lista)', async () => {
    mockDb({
      stylistAccount: {
        findMany: async () => {
          throw new Error('db down');
        },
      },
    });

    await expect(collectStylistAvatarUrlsForUser_IO(USER_ID)).resolves.toEqual(
      []
    );
  });
});
