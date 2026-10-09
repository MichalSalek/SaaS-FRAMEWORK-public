/**
 * Strażnik wag „siły galerii".
 *
 * Powstał na realnej regresji: wagi wyniku i liczby „+X%" przy pozycjach
 * checklisty żyły osobno, więc maksimum osiągalne wynosiło 90 zamiast 100.
 * Skutek był widoczny w produkcie — gałąź `hintComplete` była nieosiągalna we
 * wszystkich trzech językach, a stylistka z kompletnym profilem dostawała pustą
 * checklistę razem z komunikatem „Uzupełnij profil".
 *
 * Te asercje pilnują dwóch niezależnych własności:
 *   1. komplet profilu daje DOKŁADNIE maksimum (gałąź „kompletne" jest żywa),
 *   2. wynik nigdy nie przekracza maksimum ani nie schodzi poniżej progu
 *      endowed-progress.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateStrength,
  MAX_STRENGTH_SCORE,
  type GalleryStrengthProps,
} from './GalleryStrength.organism';

const EMPTY_PROFILE: GalleryStrengthProps = {
  photoCount: 0,
  hasProfileBio: false,
  hasProfilePhoto: false,
  hasSpecialization: false,
  pairedClientCount: 0,
};

const COMPLETE_PROFILE: GalleryStrengthProps = {
  photoCount: 10,
  hasProfileBio: true,
  hasProfilePhoto: true,
  hasSpecialization: true,
  pairedClientCount: 1,
};

describe('calculateStrength', () => {
  it('maksimum osiągalne wynosi 100 — inaczej gałąź „kompletne" jest martwa', () => {
    expect(MAX_STRENGTH_SCORE).toBe(100);
  });

  it('komplet profilu osiąga maksimum', () => {
    expect(calculateStrength(COMPLETE_PROFILE)).toBe(MAX_STRENGTH_SCORE);
  });

  it('nadmiar zdjęć i klientek nie przekracza maksimum', () => {
    expect(
      calculateStrength({
        ...COMPLETE_PROFILE,
        photoCount: 500,
        pairedClientCount: 90,
      })
    ).toBe(MAX_STRENGTH_SCORE);
  });

  it('pusty profil startuje z endowed progress, nie od zera', () => {
    const score = calculateStrength(EMPTY_PROFILE);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(MAX_STRENGTH_SCORE);
  });

  it('każdy uzupełniony element podnosi wynik (żadna waga nie jest martwa)', () => {
    const base = calculateStrength(EMPTY_PROFILE);
    const steps: ReadonlyArray<Partial<GalleryStrengthProps>> = [
      { photoCount: 1 },
      { photoCount: 5 },
      { photoCount: 10 },
      { hasProfileBio: true },
      { hasProfilePhoto: true },
      { hasSpecialization: true },
      { pairedClientCount: 1 },
    ];
    for (const step of steps) {
      expect(calculateStrength({ ...EMPTY_PROFILE, ...step })).toBeGreaterThan(
        base
      );
    }
  });

  it('wynik rośnie monotonicznie z liczbą zdjęć', () => {
    const scores = [0, 1, 4, 5, 9, 10, 40].map(photoCount =>
      calculateStrength({ ...EMPTY_PROFILE, photoCount })
    );
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] as number);
    }
  });
});
