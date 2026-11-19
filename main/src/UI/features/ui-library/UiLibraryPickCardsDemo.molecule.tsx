// The gallery card in its pick mode (choosing photos for an inspiration
// session), before and after the photo is added. Own file: the app section
// of the library is at the line limit.

import {
  GalleryPhotoCardOrganism,
  type GalleryRecordView,
} from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';

export function GalleryPickCardsDemoMolecule({
  record,
}: {
  record: GalleryRecordView;
}) {
  return (
    <>
      {[false, true].map(selected => (
        <GalleryPhotoCardOrganism
          key={String(selected)}
          record={{ ...record, gallery_record_id: `pick-${String(selected)}` }}
          onCardClick={() => undefined}
          selection={{
            selected,
            addLabel: 'Dodaj zdjęcie do sesji',
            removeLabel: 'Usuń zdjęcie z sesji',
          }}
        />
      ))}
    </>
  );
}
