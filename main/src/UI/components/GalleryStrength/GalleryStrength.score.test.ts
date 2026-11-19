/**
 * Guard for the gallery-strength weights. If the score weights and the
 * checklist "+X%" drift, a complete profile cannot reach 100 and the
 * `hintComplete` branch dies (an empty checklist next to „Uzupełnij profil").
 *
 * Two independent properties:
 *   1. a complete profile gives EXACTLY the maximum (the "complete" branch is live),
 *   2. the score never exceeds the maximum nor drops below the endowed-progress floor.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateStrength,
  getPhotoMilestones,
  MAX_STRENGTH_SCORE,
  type GalleryStrengthProps,
} from './GalleryStrength.organism';

const EMPTY_PROFILE: GalleryStrengthProps = {
  photoCount: 0,
  maxPhotos: -1,
  hasProfileBio: false,
  hasProfilePhoto: false,
  hasPinnedWork: false,
  pairedClientCount: 0,
};

const COMPLETE_PROFILE: GalleryStrengthProps = {
  photoCount: 10,
  maxPhotos: -1,
  hasProfileBio: true,
  hasProfilePhoto: true,
  hasPinnedWork: true,
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
      { hasPinnedWork: true },
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

describe('plan-aware photo goals', () => {
  it('Free Demo can reach 100 with five photos', () => {
    expect(
      calculateStrength({ ...COMPLETE_PROFILE, photoCount: 5, maxPhotos: 5 })
    ).toBe(100);
    expect(getPhotoMilestones(5)).toEqual([
      { target: 1, points: 5 },
      { target: 5, points: 25 },
    ]);
  });
  it('merges even the first goal for a one-photo cap', () => {
    expect(getPhotoMilestones(1)).toEqual([{ target: 1, points: 30 }]);
  });
  it('unknown limits and missing actual profile fields cannot claim completion', () => {
    expect(
      calculateStrength({ ...COMPLETE_PROFILE, maxPhotos: undefined })
    ).toBe(70);
    expect(
      calculateStrength({ ...COMPLETE_PROFILE, hasProfileBio: false })
    ).toBe(90);
    expect(
      calculateStrength({ ...COMPLETE_PROFILE, hasPinnedWork: false })
    ).toBe(90);
  });
});
