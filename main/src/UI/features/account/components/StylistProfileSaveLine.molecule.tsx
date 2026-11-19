// One autosave line per profile box, so a field reports success beside itself.
import { ProfileSaveLineMolecule } from '../../shared/profile/ProfileSaveLine.molecule';

export type StylistProfileBox = 'identity' | 'location' | 'contact' | 'link';

export type StylistProfileSaveSection =
  | 'location'
  | 'contact'
  | 'identity'
  | 'vanity'
  | 'social'
  | 'links'
  | 'branding';

/** Which API sections a box owns; a failure in any of them marks the box. */
const BOX_SECTIONS: Record<
  StylistProfileBox,
  readonly StylistProfileSaveSection[]
> = {
  identity: ['identity'],
  location: ['location'],
  contact: ['contact', 'social', 'links'],
  link: ['vanity'],
};

export function StylistProfileSaveLineMolecule({
  resetKey,
  box,
  isSaving,
  isDirty,
  failedSections,
  onRetry,
}: {
  resetKey: string;
  box: StylistProfileBox;
  isSaving: boolean;
  isDirty: boolean;
  failedSections: ReadonlySet<StylistProfileSaveSection>;
  onRetry: () => void;
}) {
  return (
    <ProfileSaveLineMolecule
      key={resetKey}
      isSaving={isSaving}
      isDirty={isDirty}
      hasFailure={BOX_SECTIONS[box].some(section =>
        failedSections.has(section)
      )}
      onRetry={onRetry}
    />
  );
}
