/**
 * Batch i18n key generator — adds missing keys to all 3 locale JSONs.
 * Run: node scripts/i18n-batch-add.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, '../main/src/locales');

// ─── NEW KEYS ──────────────────────────────────────────────────────
// Structure: { namespace: { key: { pl, en, de } } }
// Nested namespaces use dot notation in the key: "sub.key"

const NEW_KEYS = {
  buttons: {
    no: { pl: 'Nie', en: 'No', de: 'Nein' },
    yes: { pl: 'Tak', en: 'Yes', de: 'Ja' },
    browse: { pl: 'Przeglądaj', en: 'Browse', de: 'Durchsuchen' },
    back: { pl: 'Wróć', en: 'Back', de: 'Zurück' },
    retry: { pl: 'Spróbuj ponownie', en: 'Try again', de: 'Erneut versuchen' },
    next: { pl: 'Dalej', en: 'Next', de: 'Weiter' },
    previous: { pl: 'Wstecz', en: 'Back', de: 'Zurück' },
    publish: { pl: 'Opublikuj', en: 'Publish', de: 'Veröffentlichen' },
    notNow: { pl: 'Nie teraz', en: 'Not now', de: 'Nicht jetzt' },
  },
  labels: {
    clientFallback: { pl: 'Klientka', en: 'Client', de: 'Kundin' },
  },
  pages: {
    explore: {
      favoriteError: { pl: 'Nie udało się zaktualizować ulubionych', en: 'Failed to update favorites', de: 'Favoriten konnten nicht aktualisiert werden' },
      tabStyles: { pl: 'Stylizacje', en: 'Styles', de: 'Designs' },
      tabStylists: { pl: 'Stylistki', en: 'Stylists', de: 'Stylistinnen' },
      searchPlaceholder: { pl: 'Szukaj stylizacji...', en: 'Search styles...', de: 'Designs suchen...' },
      resultCount: { pl: '{count} stylizacji', en: '{count} styles', de: '{count} Designs' },
      loadError: { pl: 'Wystąpił błąd podczas ładowania. Spróbuj ponownie.', en: 'An error occurred while loading. Please try again.', de: 'Beim Laden ist ein Fehler aufgetreten. Bitte versuche es erneut.' },
      emptyTitle: { pl: 'Nie znaleziono stylizacji', en: 'No styles found', de: 'Keine Designs gefunden' },
      emptyHint: { pl: 'Zmień filtry lub odkrywaj wszystkie', en: 'Change filters or browse all', de: 'Filter ändern oder alle durchsuchen' },
      citiesAll: { pl: 'Wszystkie', en: 'All', de: 'Alle' },
      citiesOther: { pl: 'Inne', en: 'Other', de: 'Andere' },
      searchStylistPlaceholder: { pl: 'Szukaj stylistki...', en: 'Search stylist...', de: 'Stylistin suchen...' },
      stylistResultCount: { pl: '{count} stylistek', en: '{count} stylists', de: '{count} Stylistinnen' },
      stylistsNoResults: { pl: 'Brak wyników', en: 'No results', de: 'Keine Ergebnisse' },
      stylistsNoResultsHint: { pl: 'Zmień kryteria wyszukiwania.', en: 'Try different search criteria.', de: 'Versuche andere Suchkriterien.' },
      stylistPhotoCount: { pl: '{count} zdjęć', en: '{count} photos', de: '{count} Fotos' },
    },
    gallery: {
      myTitle: { pl: 'Twoja galeria', en: 'Your gallery', de: 'Deine Galerie' },
      loadError: { pl: 'Nie udało się załadować galerii', en: 'Failed to load gallery', de: 'Galerie konnte nicht geladen werden' },
      pinnedCount: { pl: 'Przypiętych: {current} / {max}', en: 'Pinned: {current} / {max}', de: 'Angepinnt: {current} / {max}' },
      pinHintNone: { pl: 'Przypnij przynajmniej jedno zdjęcie, żeby Twój profil był widoczny publicznie', en: 'Pin at least one photo to make your profile publicly visible', de: 'Pinne mindestens ein Foto an, damit dein Profil öffentlich sichtbar ist' },
      pinHintSome: { pl: 'Przypięte zdjęcia są widoczne publicznie na Twoim profilu', en: 'Pinned photos are publicly visible on your profile', de: 'Angepinnte Fotos sind öffentlich auf deinem Profil sichtbar' },
      galleryCount: { pl: 'Galeria ({count})', en: 'Gallery ({count})', de: 'Galerie ({count})' },
      emptyTitle: { pl: 'Twoja galeria czeka na pierwsze zdjęcie', en: 'Your gallery awaits its first photo', de: 'Deine Galerie wartet auf das erste Foto' },
      emptyHint: { pl: 'Klientki już szukają — dodaj swoje prace i bądź widoczna.', en: 'Clients are already looking — add your work and be visible.', de: 'Kundinnen suchen bereits — füge deine Arbeiten hinzu und werde sichtbar.' },
      emptyCtaFirst: { pl: 'Dodaj pierwsze zdjęcie', en: 'Add first photo', de: 'Erstes Foto hinzufügen' },
      photoDetailTitle: { pl: 'Zdjęcie', en: 'Photo', de: 'Foto' },
      photoNotFound: { pl: 'Zdjęcie nie znalezione', en: 'Photo not found', de: 'Foto nicht gefunden' },
      photoDeleted: { pl: 'Zdjęcie usunięte', en: 'Photo deleted', de: 'Foto gelöscht' },
      deleteError: { pl: 'Nie udało się usunąć zdjęcia', en: 'Failed to delete photo', de: 'Foto konnte nicht gelöscht werden' },
      photoDetailAlt: { pl: 'Stylizacja paznokci', en: 'Nail design', de: 'Nageldesign' },
      nailLengthLabel: { pl: 'Długość: {label}', en: 'Length: {label}', de: 'Länge: {label}' },
      pinSimple: { pl: 'Przypnij', en: 'Pin', de: 'Anpinnen' },
      deletePhotoBtn: { pl: 'Usuń zdjęcie', en: 'Delete photo', de: 'Foto löschen' },
      liked: { pl: 'Polubiono', en: 'Liked', de: 'Gefällt mir' },
      like: { pl: 'Polub', en: 'Like', de: 'Gefällt mir' },
      reportPhoto: { pl: 'Zgłoś zdjęcie', en: 'Report photo', de: 'Foto melden' },
      deleteConfirmTitle: { pl: 'Usunąć zdjęcie?', en: 'Delete photo?', de: 'Foto löschen?' },
      deleteConfirmBody: { pl: 'Czy na pewno chcesz usunąć to zdjęcie z galerii? Tej operacji nie można cofnąć.', en: 'Are you sure you want to delete this photo from your gallery? This action cannot be undone.', de: 'Möchtest du dieses Foto wirklich aus deiner Galerie löschen? Diese Aktion kann nicht rückgängig gemacht werden.' },
      deleteConfirmNo: { pl: 'Nie', en: 'No', de: 'Nein' },
      deleteConfirmYes: { pl: 'Tak, usuń', en: 'Yes, delete', de: 'Ja, löschen' },
      stylistGalleryTitle: { pl: 'Galeria stylistki', en: "Stylist's gallery", de: 'Galerie der Stylistin' },
      pairingBanner: { pl: 'Widzisz wybrane prace. Sparuj się ze stylistką, aby zobaczyć pełną galerię.', en: 'You see selected works. Pair with the stylist to see the full gallery.', de: 'Du siehst ausgewählte Arbeiten. Verbinde dich mit der Stylistin, um die vollständige Galerie zu sehen.' },
      stylistEmpty: { pl: 'Ta stylistka nie ma jeszcze zdjęć w galerii', en: 'This stylist has no photos in her gallery yet', de: 'Diese Stylistin hat noch keine Fotos in ihrer Galerie' },
      filtersChangeHint: { pl: 'Zmień filtry, aby zobaczyć stylizacje.', en: 'Change filters to see styles.', de: 'Ändere die Filter, um Designs zu sehen.' },
      uploadTitle: { pl: 'Dodaj stylizację', en: 'Add design', de: 'Design hinzufügen' },
      uploadFileTooLarge: { pl: 'Plik jest za duży (max 10 MB)', en: 'File is too large (max 10 MB)', de: 'Datei ist zu groß (max. 10 MB)' },
      uploadSuccess: { pl: 'Zdjęcie dodane!', en: 'Photo added!', de: 'Foto hinzugefügt!' },
      uploadFailed: { pl: 'Nie udało się dodać zdjęcia', en: 'Failed to add photo', de: 'Foto konnte nicht hinzugefügt werden' },
      uploadStep: { pl: 'Krok {step} z 3', en: 'Step {step} of 3', de: 'Schritt {step} von 3' },
      uploadSelectTitle: { pl: 'Wybierz zdjęcie', en: 'Select photo', de: 'Foto auswählen' },
      uploadFileHint: { pl: 'JPG, PNG do 10 MB', en: 'JPG, PNG up to 10 MB', de: 'JPG, PNG bis zu 10 MB' },
      uploadProgressUploading: { pl: 'Przesyłanie zdjęcia...', en: 'Uploading photo...', de: 'Foto wird hochgeladen...' },
      uploadProgressSaving: { pl: 'Zapisywanie stylizacji...', en: 'Saving design...', de: 'Design wird gespeichert...' },
      uploadSuccessHint: { pl: 'Twoja stylizacja jest już widoczna w galerii.', en: 'Your design is now visible in the gallery.', de: 'Dein Design ist jetzt in der Galerie sichtbar.' },
      uploadAddAnother: { pl: 'Dodaj kolejne', en: 'Add another', de: 'Weiteres hinzufügen' },
      uploadBackToGallery: { pl: 'Wróć do galerii', en: 'Back to gallery', de: 'Zurück zur Galerie' },
      uploadErrorTitle: { pl: 'Coś poszło nie tak', en: 'Something went wrong', de: 'Etwas ist schiefgelaufen' },
      uploadErrorHint: { pl: 'Nie udało się przesłać zdjęcia. Spróbuj ponownie.', en: 'Failed to upload photo. Please try again.', de: 'Foto konnte nicht hochgeladen werden. Bitte versuche es erneut.' },
      uploadRetry: { pl: 'Spróbuj ponownie', en: 'Try again', de: 'Erneut versuchen' },
      uploadPreviewAlt: { pl: 'Podgląd zdjęcia', en: 'Photo preview', de: 'Fotovorschau' },
      uploadTagTitle: { pl: 'Otaguj stylizację', en: 'Tag your design', de: 'Design taggen' },
      uploadColorsLabel: { pl: 'Kolory (max {max})', en: 'Colors (max {max})', de: 'Farben (max. {max})' },
      uploadTraitsLabel: { pl: 'Cechy stylizacji (min 1)', en: 'Design traits (min 1)', de: 'Designmerkmale (min. 1)' },
      uploadNailLengthLabel: { pl: 'Długość paznokcia', en: 'Nail length', de: 'Nagellänge' },
      uploadBack: { pl: 'Wstecz', en: 'Back', de: 'Zurück' },
      uploadNext: { pl: 'Dalej', en: 'Next', de: 'Weiter' },
      uploadSummaryTitle: { pl: 'Podsumowanie', en: 'Summary', de: 'Zusammenfassung' },
      uploadSummaryColors: { pl: 'Kolory', en: 'Colors', de: 'Farben' },
      uploadSummaryTraits: { pl: 'Cechy', en: 'Traits', de: 'Merkmale' },
      uploadSummaryLength: { pl: 'Długość', en: 'Length', de: 'Länge' },
      uploadPublish: { pl: 'Opublikuj', en: 'Publish', de: 'Veröffentlichen' },
      cropHint: { pl: 'Dopasuj kadr — proporcja 3:4', en: 'Adjust frame — 3:4 ratio', de: 'Rahmen anpassen — Verhältnis 3:4' },
      cropPreviewAlt: { pl: 'Podgląd do przycięcia', en: 'Preview for cropping', de: 'Vorschau zum Zuschneiden' },
      cropLoadingAlt: { pl: 'Ładowanie podglądu', en: 'Loading preview', de: 'Vorschau wird geladen' },
      cropChangePhoto: { pl: 'Zmień zdjęcie', en: 'Change photo', de: 'Foto ändern' },
      cropProcessing: { pl: 'Przycinanie...', en: 'Cropping...', de: 'Zuschneiden...' },
      cropConfirm: { pl: 'Zatwierdź kadr', en: 'Confirm crop', de: 'Zuschnitt bestätigen' },
      celebrationTitle: { pl: 'Twoje pierwsze zdjęcie!', en: 'Your first photo!', de: 'Dein erstes Foto!' },
      celebrationHint: { pl: 'Klientki już mogą zobaczyć Twoją pracę. Dodaj więcej — bogatsza galeria przyciąga więcej klientek.', en: 'Clients can already see your work. Add more — a richer gallery attracts more clients.', de: 'Kundinnen können deine Arbeit bereits sehen. Füge mehr hinzu — eine reichhaltigere Galerie zieht mehr Kundinnen an.' },
      celebrationGoToGallery: { pl: 'Przejdź do galerii', en: 'Go to gallery', de: 'Zur Galerie' },
      similarTitle: { pl: 'Podobne stylizacje', en: 'Similar designs', de: 'Ähnliche Designs' },
      similarPhotoAlt: { pl: 'Stylizacja: {traits}', en: 'Design: {traits}', de: 'Design: {traits}' },
      uploadDescriptionLabel: { pl: 'Opis stylizacji', en: 'Design description', de: 'Designbeschreibung' },
      requiredAriaLabel: { pl: 'wymagane', en: 'required', de: 'erforderlich' },
      uploadDescriptionPlaceholder: { pl: 'np. Krótkie paznokcie migdał, czerwone matowe, wzór florystyczny', en: 'e.g. Short almond nails, matte red, floral pattern', de: 'z.B. Kurze Mandelnägel, mattes Rot, Blumenmuster' },
      uploadDescriptionHint: { pl: 'Min. {min} znaków ({current}/{min}). Pomaga klientkom znaleźć Twoją pracę i niewidomym użytkownikom (alt text).', en: 'Min. {min} characters ({current}/{min}). Helps clients find your work and visually impaired users (alt text).', de: 'Min. {min} Zeichen ({current}/{min}). Hilft Kundinnen deine Arbeit zu finden und sehbehinderten Nutzern (Alt-Text).' },
      uploadDescriptionError: { pl: 'Opis musi mieć przynajmniej {min} znaków.', en: 'Description must have at least {min} characters.', de: 'Beschreibung muss mindestens {min} Zeichen haben.' },
      planLimitReached: { pl: 'Osiągnięto limit planu.', en: 'Plan limit reached.', de: 'Planlimit erreicht.' },
      changePlan: { pl: 'Zmień plan', en: 'Change plan', de: 'Plan ändern' },
      planSlotsRemaining: { pl: 'Zostało {count} miejsc w planie', en: '{count} slots remaining in plan', de: '{count} Plätze im Plan übrig' },
      upgradeDialogLabel: { pl: 'Uaktualnij plan', en: 'Upgrade plan', de: 'Plan upgraden' },
      upgradeTitle: { pl: 'Nie trać szansy na więcej klientek', en: "Don't miss out on more clients", de: 'Verpasse nicht die Chance auf mehr Kundinnen' },
      upgradeBody: { pl: 'Twój plan {plan} pozwala na {max} zdjęć. Więcej zdjęć = więcej klientek, które Cię znajdą.', en: 'Your {plan} plan allows {max} photos. More photos = more clients who find you.', de: 'Dein {plan}-Plan erlaubt {max} Fotos. Mehr Fotos = mehr Kundinnen, die dich finden.' },
      upgradeCta: { pl: 'Przejdź na Pro', en: 'Upgrade to Pro', de: 'Auf Pro upgraden' },
      upgradeNotNow: { pl: 'Nie teraz', en: 'Not now', de: 'Nicht jetzt' },
    },
    sessions: {
      sessionTitle: { pl: 'Sesja inspiracji', en: 'Inspiration session', de: 'Inspirationssitzung' },
      mySessionsTitle: { pl: 'Twoje sesje', en: 'Your sessions', de: 'Deine Sitzungen' },
      statusDraft: { pl: 'Szkic', en: 'Draft', de: 'Entwurf' },
      statusReady: { pl: 'Gotowa', en: 'Ready', de: 'Bereit' },
      statusShared: { pl: 'Udostępniona', en: 'Shared', de: 'Geteilt' },
      statusActive: { pl: 'Aktywna', en: 'Active', de: 'Aktiv' },
      statusExpired: { pl: 'Wygasła', en: 'Expired', de: 'Abgelaufen' },
      statusClosed: { pl: 'Zamknięta', en: 'Closed', de: 'Geschlossen' },
      loading: { pl: 'Ładowanie sesji…', en: 'Loading sessions…', de: 'Sitzungen werden geladen…' },
      loadError: { pl: 'Nie udało się załadować sesji.', en: 'Failed to load sessions.', de: 'Sitzungen konnten nicht geladen werden.' },
      loadingShort: { pl: 'Ładowanie…', en: 'Loading…', de: 'Laden…' },
      retryBtn: { pl: 'Spróbuj ponownie', en: 'Try again', de: 'Erneut versuchen' },
      activeSectionTitle: { pl: 'Aktywne ({count})', en: 'Active ({count})', de: 'Aktiv ({count})' },
      createNew: { pl: 'Utwórz nową sesję', en: 'Create new session', de: 'Neue Sitzung erstellen' },
      createFirstSession: { pl: 'Utwórz pierwszą sesję', en: 'Create first session', de: 'Erste Sitzung erstellen' },
      photoCount: { pl: '{count} zdjęć', en: '{count} photos', de: '{count} Fotos' },
      expiresIn: { pl: 'Wygasa za {time}', en: 'Expires in {time}', de: 'Läuft ab in {time}' },
      onboardingSubtitle: { pl: 'Przygotuj się do wizyty u stylistki', en: 'Prepare for your visit to the stylist', de: 'Bereite dich auf deinen Besuch bei der Stylistin vor' },
      step1Title: { pl: 'Wybierz inspiracje', en: 'Choose inspirations', de: 'Wähle Inspirationen' },
      step1Hint: { pl: 'Przeglądaj galerię stylistki i dodawaj zdjęcia', en: "Browse the stylist's gallery and add photos", de: 'Durchstöbere die Galerie der Stylistin und füge Fotos hinzu' },
      step2Title: { pl: 'Dodaj notatki', en: 'Add notes', de: 'Notizen hinzufügen' },
      step2Hint: { pl: '„Taki kształt", „ten kolor na wesele"', en: '"This shape", "this color for the wedding"', de: '„Diese Form", „diese Farbe für die Hochzeit"' },
      step3Hint: { pl: 'Stylistka zobaczy w schowku — może się przygotować przed wizytą', en: 'The stylist will see it in the clipboard — she can prepare before your visit', de: 'Die Stylistin sieht es in der Ablage — sie kann sich vor deinem Besuch vorbereiten' },
      sessionNotFound: { pl: 'Sesja nie istnieje', en: 'Session not found', de: 'Sitzung nicht gefunden' },
      backToSessions: { pl: 'Wróć do sesji', en: 'Back to sessions', de: 'Zurück zu Sitzungen' },
      sharedAt: { pl: 'Udostępniona {time}', en: 'Shared {time}', de: 'Geteilt {time}' },
      draftHint: { pl: 'Szkic — dodaj inspiracje i udostępnij', en: 'Draft — add inspirations and share', de: 'Entwurf — füge Inspirationen hinzu und teile' },
      addPhotoToShare: { pl: 'Dodaj przynajmniej jedną stylizację, żeby udostępnić', en: 'Add at least one design to share', de: 'Füge mindestens ein Design hinzu, um zu teilen' },
      expiresWithNote: { pl: 'Wygasa za {time} — możesz nadal dodawać zdjęcia', en: 'Expires in {time} — you can still add photos', de: 'Läuft ab in {time} — du kannst noch Fotos hinzufügen' },
      shareCaption: { pl: 'Stylistka zobaczy zdjęcia w schowku — będzie mogła się przygotować przed wizytą', en: 'The stylist will see photos in the clipboard — she can prepare before your visit', de: 'Die Stylistin sieht die Fotos in der Ablage — sie kann sich vor deinem Besuch vorbereiten' },
      sharingInProgress: { pl: 'Udostępnianie...', en: 'Sharing...', de: 'Wird geteilt...' },
      inspirationsCount: { pl: 'Inspiracje ({count})', en: 'Inspirations ({count})', de: 'Inspirationen ({count})' },
      inspirationAlt: { pl: 'Inspiracja', en: 'Inspiration', de: 'Inspiration' },
      noInspirations: { pl: 'Nie masz jeszcze żadnych inspiracji w tej sesji.', en: "You don't have any inspirations in this session yet.", de: 'Du hast noch keine Inspirationen in dieser Sitzung.' },
      browseGallery: { pl: 'Przeglądaj galerie stylistki', en: "Browse stylist's gallery", de: 'Galerie der Stylistin durchsuchen' },
      addFromGallery: { pl: 'Dodaj inspiracje z galerii', en: 'Add inspirations from gallery', de: 'Inspirationen aus der Galerie hinzufügen' },
      closeSession: { pl: 'Zamknij sesję', en: 'Close session', de: 'Sitzung schließen' },
      closeConfirmTitle: { pl: 'Zamknąć sesję?', en: 'Close session?', de: 'Sitzung schließen?' },
      closeConfirmBody: { pl: 'Stylistka straci dostęp do zdjęć z tej sesji.', en: 'The stylist will lose access to photos from this session.', de: 'Die Stylistin verliert den Zugriff auf Fotos aus dieser Sitzung.' },
      closingInProgress: { pl: 'Zamykanie...', en: 'Closing...', de: 'Wird geschlossen...' },
      shareSuccessToast: { pl: 'Sesja udostępniona stylistce', en: 'Session shared with stylist', de: 'Sitzung mit Stylistin geteilt' },
      shareErrorToast: { pl: 'Nie udało się udostępnić sesji', en: 'Failed to share session', de: 'Sitzung konnte nicht geteilt werden' },
      closeSuccessToast: { pl: 'Sesja została zamknięta', en: 'Session has been closed', de: 'Sitzung wurde geschlossen' },
      closeErrorToast: { pl: 'Nie udało się zamknąć sesji', en: 'Failed to close session', de: 'Sitzung konnte nicht geschlossen werden' },
      createErrorToast: { pl: 'Nie udało się utworzyć sesji. Spróbuj ponownie.', en: 'Failed to create session. Please try again.', de: 'Sitzung konnte nicht erstellt werden. Bitte versuche es erneut.' },
      noteSaveError: { pl: 'Nie udało się zapisać notatki', en: 'Failed to save note', de: 'Notiz konnte nicht gespeichert werden' },
      waitingForClient: { pl: 'Oczekuje na klientkę', en: 'Waiting for client', de: 'Wartet auf Kundin' },
      daysAgo: { pl: 'Udostępniona {count} dni temu', en: 'Shared {count} days ago', de: 'Vor {count} Tagen geteilt' },
      hoursAgo: { pl: 'Udostępniona {count} godz. temu', en: 'Shared {count} hours ago', de: 'Vor {count} Stunden geteilt' },
      justNow: { pl: 'Udostępniona przed chwilą', en: 'Shared just now', de: 'Gerade geteilt' },
      clientNoPhotosYet: { pl: 'Klientka jeszcze nie dodała zdjęć', en: 'Client has not added photos yet', de: 'Kundin hat noch keine Fotos hinzugefügt' },
      clientNoPhotosHint: { pl: 'Zdjęcia pojawią się tutaj gdy klientka je wybierze', en: 'Photos will appear here when the client selects them', de: 'Fotos erscheinen hier, wenn die Kundin sie auswählt' },
      archiveTitle: { pl: 'Archiwum ({count})', en: 'Archive ({count})', de: 'Archiv ({count})' },
      sessionNotFoundStylist: { pl: 'Sesja nie znaleziona', en: 'Session not found', de: 'Sitzung nicht gefunden' },
      firstSessionTitle: { pl: 'Pierwsza sesja inspiracji!', en: 'First inspiration session!', de: 'Erste Inspirationssitzung!' },
      firstSessionHint: { pl: 'Klientka przygotowała dla Ciebie inspiracje przed wizytą. Przejrzyj zdjęcia i notatki — będziesz wiedziała dokładnie czego oczekuje.', en: 'The client has prepared inspirations for your visit. Review photos and notes — you will know exactly what she expects.', de: 'Die Kundin hat Inspirationen für deinen Besuch vorbereitet. Sieh dir Fotos und Notizen an — du weißt genau, was sie erwartet.' },
      firstSessionAck: { pl: 'Rozumiem, przeglądam', en: 'Got it, browsing', de: 'Verstanden, schaue mir an' },
      clientLabel: { pl: 'Klientka', en: 'Client', de: 'Kundin' },
      notSharedYet: { pl: 'Sesja nie jest jeszcze udostępniona', en: 'Session is not shared yet', de: 'Sitzung ist noch nicht geteilt' },
      refreshBtn: { pl: 'Odśwież', en: 'Refresh', de: 'Aktualisieren' },
      noteTitle: { pl: 'Notatka', en: 'Note', de: 'Notiz' },
      notePlaceholder: { pl: 'Twoje uwagi do tej wizyty...', en: 'Your notes for this visit...', de: 'Deine Notizen für diesen Besuch...' },
      notePrivacyHint: { pl: 'Tylko Ty widzisz tę notatkę. Klientka nie ma do niej dostępu.', en: 'Only you can see this note. The client has no access to it.', de: 'Nur du kannst diese Notiz sehen. Die Kundin hat keinen Zugang dazu.' },
    },
    shared: {
      title: { pl: 'Sesje z klientkami', en: 'Sessions with clients', de: 'Sitzungen mit Kundinnen' },
      subtitle: { pl: 'Sesje udostępnione przez klientki. Aktywne przez 7 dni od udostępnienia.', en: 'Sessions shared by clients. Active for 7 days after sharing.', de: 'Von Kundinnen geteilte Sitzungen. 7 Tage nach dem Teilen aktiv.' },
      activeSectionTitle: { pl: 'Aktywne ({count})', en: 'Active ({count})', de: 'Aktiv ({count})' },
      emptyTitle: { pl: 'Schowek jest pusty', en: 'Clipboard is empty', de: 'Ablage ist leer' },
      emptyHint: { pl: 'Klientki nie udostępniły jeszcze żadnej sesji. Po sparowaniu zobaczysz tu ich inspiracje.', en: 'No client has shared a session yet. After pairing, you will see their inspirations here.', de: 'Keine Kundin hat bisher eine Sitzung geteilt. Nach dem Pairing siehst du hier ihre Inspirationen.' },
      pairClient: { pl: 'Paruj klientkę', en: 'Pair client', de: 'Kundin koppeln' },
      archivedSectionTitle: { pl: 'Zakończone ({count})', en: 'Finished ({count})', de: 'Abgeschlossen ({count})' },
      archivedSubtitle: { pl: 'Zakończone sesje — Twoje wcześniejsze wizyty z klientkami', en: 'Finished sessions — your previous visits with clients', de: 'Abgeschlossene Sitzungen — deine früheren Besuche mit Kundinnen' },
      photoCount_one: { pl: '{count} zdjęcie', en: '{count} photo', de: '{count} Foto' },
      photoCount_other: { pl: '{count} zdjęć', en: '{count} photos', de: '{count} Fotos' },
      statusClosed: { pl: 'Zamknięta', en: 'Closed', de: 'Geschlossen' },
      statusExpired: { pl: 'Wygasła', en: 'Expired', de: 'Abgelaufen' },
      expiredNeuter: { pl: 'Wygasło', en: 'Expired', de: 'Abgelaufen' },
    },
    favorites: {
      collectionTitle: { pl: 'Twoja kolekcja', en: 'Your collection', de: 'Deine Sammlung' },
      loadError: { pl: 'Nie udało się załadować danych. Spróbuj odświeżyć stronę.', en: 'Failed to load data. Try refreshing the page.', de: 'Daten konnten nicht geladen werden. Versuche die Seite zu aktualisieren.' },
      stylesTab: { pl: 'Stylizacje', en: 'Styles', de: 'Designs' },
      removeDialogTitle: { pl: 'Usunąć stylizację?', en: 'Remove design?', de: 'Design entfernen?' },
      removeDialogBody: { pl: 'Czy na pewno chcesz usunąć tę stylizację z kolekcji?', en: 'Are you sure you want to remove this design from your collection?', de: 'Möchtest du dieses Design wirklich aus deiner Sammlung entfernen?' },
      removeDialogConfirm: { pl: 'Tak, usuń', en: 'Yes, remove', de: 'Ja, entfernen' },
      stylesTabEmptyTitle: { pl: 'Zapisz inspiracje z galerii stylistki — pojawią się tutaj', en: "Save inspirations from stylist's gallery — they will appear here", de: 'Speichere Inspirationen aus der Galerie der Stylistin — sie erscheinen hier' },
      stylesTabEmptyBody: { pl: 'Stylistki w Twojej okolicy dodają nowe prace codziennie — zobacz co jest popularne w tym tygodniu!', en: 'Stylists in your area add new works daily — see what is popular this week!', de: 'Stylistinnen in deiner Nähe fügen täglich neue Arbeiten hinzu — schau was diese Woche beliebt ist!' },
      stylesTabFlatView: { pl: 'Widok płaski', en: 'Flat view', de: 'Flache Ansicht' },
      stylesTabGroupBy: { pl: 'Grupuj wg stylistki', en: 'Group by stylist', de: 'Nach Stylistin gruppieren' },
      stylesTabShowAll: { pl: 'Wszystkie', en: 'All', de: 'Alle' },
      stylesTabGroup: { pl: 'Grupuj', en: 'Group', de: 'Gruppieren' },
      stylistsTabEmptyTitle: { pl: 'Twoje zapisane stylistki pojawią się tutaj', en: 'Your saved stylists will appear here', de: 'Deine gespeicherten Stylistinnen erscheinen hier' },
      stylistsTabEmptyBody: { pl: 'Zapisz stylistkę z jej profilu albo zapisz jej zdjęcia — znajdziesz ją tutaj na później.', en: "Save a stylist from her profile or save her photos — you'll find her here later.", de: 'Speichere eine Stylistin aus ihrem Profil oder speichere ihre Fotos — du findest sie hier später.' },
      stylistsTabSearchPlaceholder: { pl: 'Szukaj stylistki...', en: 'Search stylist...', de: 'Stylistin suchen...' },
      stylistsTabSortOldest: { pl: 'Sortuj: najstarsze', en: 'Sort: oldest', de: 'Sortieren: älteste' },
      stylistsTabSortNewest: { pl: 'Sortuj: najnowsze', en: 'Sort: newest', de: 'Sortieren: neueste' },
      stylistsTabNoResults: { pl: 'Brak wyników dla „{query}"', en: 'No results for "{query}"', de: 'Keine Ergebnisse für „{query}"' },
    },
    clientProfile: {
      preferencesTitle: { pl: 'Moje preferencje', en: 'My preferences', de: 'Meine Präferenzen' },
      preferencesSubtitle: { pl: 'Wybierz style, które Cię interesują — pomogą stylistkom lepiej Cię zrozumieć.', en: 'Choose styles that interest you — they help stylists understand you better.', de: 'Wähle Stile, die dich interessieren — sie helfen Stylistinnen dich besser zu verstehen.' },
      cannotUpdatePrefs: { pl: 'Nie udało się zapisać preferencji', en: 'Failed to save preferences', de: 'Präferenzen konnten nicht gespeichert werden' },
      changeAvatarAria: { pl: 'Zmień zdjęcie profilowe', en: 'Change profile photo', de: 'Profilfoto ändern' },
      editProfile: { pl: 'Edytuj profil', en: 'Edit profile', de: 'Profil bearbeiten' },
      saving: { pl: 'Zapisywanie...', en: 'Saving...', de: 'Speichern...' },
      infoNote: { pl: 'Twój profil pomaga stylistkom lepiej Cię poznać i przygotować się do wizyty. Możesz go edytować w dowolnym momencie.', en: 'Your profile helps stylists get to know you better and prepare for your visit. You can edit it anytime.', de: 'Dein Profil hilft Stylistinnen dich besser kennenzulernen und sich auf deinen Besuch vorzubereiten. Du kannst es jederzeit bearbeiten.' },
      stylePreferences: {
        gel: { pl: 'Żelowe', en: 'Gel', de: 'Gel' },
        acrylic: { pl: 'Akrylowe', en: 'Acrylic', de: 'Acryl' },
        nailArt: { pl: 'Nail art', en: 'Nail art', de: 'Nail Art' },
        natural: { pl: 'Naturalne', en: 'Natural', de: 'Natürlich' },
        french: { pl: 'French', en: 'French', de: 'French' },
        ombre: { pl: 'Ombre', en: 'Ombre', de: 'Ombre' },
        minimalist: { pl: 'Minimalistyczne', en: 'Minimalist', de: 'Minimalistisch' },
        bold: { pl: 'Wyraziste', en: 'Bold', de: 'Ausdrucksstark' },
      },
    },
    emailUnsubscribe: {
      loadingTitle: { pl: 'Wypisywanie z listy', en: 'Unsubscribing', de: 'Abmeldung' },
      loadingBody: { pl: 'Wypisujemy Cię z listy mailingowej…', en: 'We are unsubscribing you from the mailing list…', de: 'Wir melden dich von der Mailingliste ab…' },
      successTitle: { pl: 'Wypisano pomyślnie', en: 'Unsubscribed successfully', de: 'Erfolgreich abgemeldet' },
      successBody: { pl: 'Nie będziemy już wysyłać Ci emaili marketingowych.', en: 'We will no longer send you marketing emails.', de: 'Wir werden dir keine Marketing-E-Mails mehr senden.' },
      backHome: { pl: 'Wróć do strony głównej', en: 'Back to homepage', de: 'Zurück zur Startseite' },
      errorTitle: { pl: 'Nie udało się wypisać', en: 'Unsubscribe failed', de: 'Abmeldung fehlgeschlagen' },
      noTokenTitle: { pl: 'Nieprawidłowy link', en: 'Invalid link', de: 'Ungültiger Link' },
      noTokenBody: { pl: 'Sprawdź, czy skopiowałeś cały link z emaila.', en: 'Make sure you copied the entire link from the email.', de: 'Stelle sicher, dass du den gesamten Link aus der E-Mail kopiert hast.' },
      defaultError: { pl: 'Token wygasł lub jest nieprawidłowy. Skontaktuj się z supportem.', en: 'Token has expired or is invalid. Please contact support.', de: 'Token ist abgelaufen oder ungültig. Bitte kontaktiere den Support.' },
      errorTokenExpired: { pl: 'Link wygasł. Skontaktuj się z supportem, jeśli chcesz wypisać się z listy.', en: 'Link has expired. Contact support if you want to unsubscribe.', de: 'Link ist abgelaufen. Kontaktiere den Support, wenn du dich abmelden möchtest.' },
      errorTokenInvalid: { pl: 'Link jest nieprawidłowy. Sprawdź, czy skopiowałeś cały adres z emaila.', en: 'Link is invalid. Make sure you copied the entire address from the email.', de: 'Link ist ungültig. Stelle sicher, dass du die gesamte Adresse aus der E-Mail kopiert hast.' },
      errorAlreadyUnsubscribed: { pl: 'Już wcześniej zostałeś wypisany z tej listy.', en: 'You have already been unsubscribed from this list.', de: 'Du wurdest bereits von dieser Liste abgemeldet.' },
      errorGeneric: { pl: 'Wystąpił błąd podczas wypisywania. Spróbuj ponownie lub skontaktuj się z supportem.', en: 'An error occurred while unsubscribing. Please try again or contact support.', de: 'Beim Abmelden ist ein Fehler aufgetreten. Bitte versuche es erneut oder kontaktiere den Support.' },
      initializing: { pl: 'Inicjalizowanie…', en: 'Initializing…', de: 'Initialisierung…' },
    },
    deleteSelf: {
      title: { pl: 'Usuń konto', en: 'Delete account', de: 'Konto löschen' },
      toastSendError: { pl: 'Nie udało się wysłać potwierdzenia. Spróbuj ponownie.', en: 'Failed to send confirmation. Please try again.', de: 'Bestätigung konnte nicht gesendet werden. Bitte versuche es erneut.' },
      irreversibleTitle: { pl: 'To działanie jest nieodwracalne', en: 'This action is irreversible', de: 'Diese Aktion ist unwiderruflich' },
      irreversibleDesc: { pl: 'Po potwierdzeniu konto zostanie oznaczone do usunięcia. Wszystkie dane, zdjęcia i połączenia zostaną trwale usunięte.', en: 'After confirmation, the account will be marked for deletion. All data, photos and connections will be permanently deleted.', de: 'Nach der Bestätigung wird das Konto zur Löschung markiert. Alle Daten, Fotos und Verbindungen werden dauerhaft gelöscht.' },
      graceTitle: { pl: '30-dniowy okres ochronny', en: '30-day grace period', de: '30-Tage-Schutzfrist' },
      graceDesc: { pl: 'Masz 30 dni na zmianę decyzji. Wystarczy zalogować się ponownie, aby przywrócić konto.', en: 'You have 30 days to change your mind. Simply log in again to restore your account.', de: 'Du hast 30 Tage Zeit, deine Meinung zu ändern. Logge dich einfach wieder ein, um dein Konto wiederherzustellen.' },
      consequencesTitle: { pl: 'Co zostanie usunięte:', en: 'What will be deleted:', de: 'Was gelöscht wird:' },
      consequencesPhotos: { pl: 'Zdjęcia i galeria', en: 'Photos and gallery', de: 'Fotos und Galerie' },
      consequencesInspirations: { pl: 'Zapisane inspiracje i kolekcja', en: 'Saved inspirations and collection', de: 'Gespeicherte Inspirationen und Sammlung' },
      consequencesPairings: { pl: 'Połączenia ze stylistkami', en: 'Connections with stylists', de: 'Verbindungen mit Stylistinnen' },
      consequencesAccount: { pl: 'Dane konta i ustawienia', en: 'Account data and settings', de: 'Kontodaten und Einstellungen' },
      confirmCheckbox: { pl: 'Rozumiem, że po 30 dniach moje dane zostaną trwale usunięte', en: 'I understand that after 30 days my data will be permanently deleted', de: 'Ich verstehe, dass meine Daten nach 30 Tagen dauerhaft gelöscht werden' },
      confirmButton: { pl: 'Usuń moje konto', en: 'Delete my account', de: 'Mein Konto löschen' },
      confirmButtonLoading: { pl: 'Przetwarzanie...', en: 'Processing...', de: 'Verarbeitung...' },
      emailSentTitle: { pl: 'Sprawdź swoją skrzynkę', en: 'Check your inbox', de: 'Überprüfe deinen Posteingang' },
      emailSentDesc: { pl: 'Wysłaliśmy email z linkiem potwierdzającym usunięcie konta.', en: 'We sent an email with a link to confirm account deletion.', de: 'Wir haben eine E-Mail mit einem Bestätigungslink zur Kontolöschung gesendet.' },
      emailSentHint: { pl: 'Kliknij link w emailu, aby potwierdzić usunięcie. Link jest ważny 24 godziny.', en: 'Click the link in the email to confirm deletion. The link is valid for 24 hours.', de: 'Klicke auf den Link in der E-Mail, um die Löschung zu bestätigen. Der Link ist 24 Stunden gültig.' },
      backToAccount: { pl: 'Wróć do konta', en: 'Back to account', de: 'Zurück zum Konto' },
    },
    app: {
      dashboardTitle: { pl: 'Twój panel', en: 'Your dashboard', de: 'Dein Dashboard' },
      dashboardNote: {
        title: { pl: 'Notatki', en: 'Notes', de: 'Notizen' },
        placeholder: { pl: 'Twoje prywatne notatki...', en: 'Your private notes...', de: 'Deine privaten Notizen...' },
      },
    },
    home: {
      hero: {
        ariaLabel: { pl: 'Sekcja główna', en: 'Main section', de: 'Hauptbereich' },
        eyebrow: { pl: 'Twoje portfolio. Twoje zasady.', en: 'Your portfolio. Your rules.', de: 'Dein Portfolio. Deine Regeln.' },
        headlineLine1: { pl: 'Przestań tłumaczyć.', en: 'Stop explaining.', de: 'Hör auf zu erklären.' },
        headlineAccent: { pl: 'Daj klientkom zobaczyć.', en: 'Let clients see.', de: 'Lass Kundinnen sehen.' },
        lede: { pl: 'Profesjonalna galeria z inteligentnymi filtrami. Klientka przegląda Twoje prace, wybiera inspirację — i przychodzi przygotowana.', en: 'Professional gallery with smart filters. The client browses your work, picks inspiration — and comes prepared.', de: 'Professionelle Galerie mit intelligenten Filtern. Die Kundin durchstöbert deine Arbeiten, wählt Inspiration — und kommt vorbereitet.' },
        ctaPrimary: { pl: 'Chcę spróbować za darmo', en: 'I want to try for free', de: 'Ich möchte es kostenlos testen' },
        ctaForClients: { pl: 'Chodzę na paznokcie', en: 'I get my nails done', de: 'Ich gehe zur Maniküre' },
        proofAriaLabel: { pl: 'Dlaczego warto', en: 'Why it is worth it', de: 'Warum es sich lohnt' },
        proof1: { pl: 'Zacznij za darmo', en: 'Start for free', de: 'Starte kostenlos' },
        proof2: { pl: '30 dni Pro za darmo', en: '30 days Pro for free', de: '30 Tage Pro kostenlos' },
        proof3: { pl: 'Anuluj kiedy chcesz', en: 'Cancel anytime', de: 'Jederzeit kündbar' },
      },
      howItWorks: {
        eyebrow: { pl: 'Trzy kroki, bez ceremonii', en: 'Three steps, no ceremony', de: 'Drei Schritte, ohne Umschweife' },
        headline: { pl: 'Jedno narzędzie, dwa wejścia.', en: 'One tool, two entrances.', de: 'Ein Werkzeug, zwei Eingänge.' },
        lede: { pl: 'Dla Ciebie i Twoich klientek. Bez instalowania czegokolwiek po ich stronie.', en: 'For you and your clients. No installation on their side.', de: 'Für dich und deine Kundinnen. Keine Installation auf ihrer Seite.' },
        stepsAriaLabel: { pl: 'Jak to działa — kroki', en: 'How it works — steps', de: 'Wie es funktioniert — Schritte' },
      },
      steps: {
        step1Title: { pl: 'Wrzucasz swoje prace', en: 'Upload your work', de: 'Lade deine Arbeiten hoch' },
        step1Body: { pl: 'Zdjęcie stylizacji, tagi, opis — 30 sekund i gotowe.', en: 'Design photo, tags, description — 30 seconds and done.', de: 'Designfoto, Tags, Beschreibung — 30 Sekunden und fertig.' },
        step2Title: { pl: 'Wystawiasz jeden kod QR w salonie', en: 'Display one QR code in the salon', de: 'Stelle einen QR-Code im Salon aus' },
        step2Body: { pl: 'Generujesz raz, drukujesz lub wyświetlasz — klientka skanuje telefonem.', en: 'Generate once, print or display — the client scans with her phone.', de: 'Einmal generieren, drucken oder anzeigen — die Kundin scannt mit dem Handy.' },
        step3Title: { pl: 'Klientka filtruje. Ty tworzysz.', en: 'The client filters. You create.', de: 'Die Kundin filtert. Du kreierst.' },
        step3Body: { pl: 'Ona wybiera kolor, kształt, długość. Ty wiesz co zrobić zanim usiądzie w fotelu.', en: 'She picks color, shape, length. You know what to do before she sits in the chair.', de: 'Sie wählt Farbe, Form, Länge. Du weißt was zu tun ist, bevor sie auf dem Stuhl sitzt.' },
      },
      benefits: {
        eyebrow: { pl: 'Sześć powodów', en: 'Six reasons', de: 'Sechs Gründe' },
        headline: { pl: 'Wszystko, czego potrzebuje Twój salon.', en: 'Everything your salon needs.', de: 'Alles, was dein Salon braucht.' },
        lede: { pl: 'Więcej niż portfolio. Narzędzie do budowania relacji z klientkami, które wrócą.', en: 'More than a portfolio. A tool for building relationships with clients who come back.', de: 'Mehr als ein Portfolio. Ein Werkzeug zum Aufbau von Beziehungen mit Kundinnen, die wiederkommen.' },
        commissionLabel: { pl: 'prowizji od klientek', en: 'commission from clients', de: 'Provision von Kundinnen' },
        clientLabel: { pl: 'Klientka', en: 'Client', de: 'Kundin' },
        youLabel: { pl: 'Ty', en: 'You', de: 'Du' },
        mockupsAriaLabel: { pl: 'Podgląd ekranów aplikacji', en: 'App screens preview', de: 'Vorschau der App-Bildschirme' },
        clientsAlwaysFree: { pl: 'Klientki korzystają zawsze za darmo.', en: 'Clients always use it for free.', de: 'Kundinnen nutzen es immer kostenlos.' },
      },
      stickyCta: {
        text: { pl: 'Gotowa na własne portfolio?', en: 'Ready for your own portfolio?', de: 'Bereit für dein eigenes Portfolio?' },
        button: { pl: 'Stwórz portfolio za darmo', en: 'Create portfolio for free', de: 'Portfolio kostenlos erstellen' },
      },
      trust: {
        eyebrow: { pl: 'Czemu można nam zaufać', en: 'Why you can trust us', de: 'Warum du uns vertrauen kannst' },
        stat1Label: { pl: 'prowizji od klientek', en: 'commission from clients', de: 'Provision von Kundinnen' },
        stat2Label: { pl: 'własność Twoich zdjęć', en: 'ownership of your photos', de: 'Eigentum an deinen Fotos' },
        stat3Label: { pl: 'konfiguracja konta od zera', en: 'account setup from scratch', de: 'Kontoeinrichtung von Grund auf' },
        body: { pl: 'Działamy w Polsce, zgodnie z RODO. Twoje zdjęcia są Twoje — nie wykorzystujemy ich do reklam ani nie udostępniamy osobom trzecim.', en: 'We operate in Poland, in compliance with GDPR. Your photos are yours — we do not use them for ads or share them with third parties.', de: 'Wir arbeiten in Polen, DSGVO-konform. Deine Fotos gehören dir — wir nutzen sie nicht für Werbung und teilen sie nicht mit Dritten.' },
        listAriaLabel: { pl: 'Certyfikaty i gwarancje', en: 'Certificates and guarantees', de: 'Zertifikate und Garantien' },
        badge1: { pl: 'RODO · UE', en: 'GDPR · EU', de: 'DSGVO · EU' },
        badge2: { pl: 'Stripe Secure', en: 'Stripe Secure', de: 'Stripe Secure' },
        badge3: { pl: 'Polska firma', en: 'Polish company', de: 'Polnisches Unternehmen' },
      },
      testimonials: {
        title: { pl: 'Co mówią stylistki', en: 'What stylists say', de: 'Was Stylistinnen sagen' },
      },
      clientStrip: {
        headline: { pl: 'Też chodzisz na paznokcie?', en: 'Do you get your nails done too?', de: 'Gehst du auch zur Maniküre?' },
        body: { pl: 'Przeglądaj galerię swojej stylistki, wybieraj inspiracje przed wizytą i bądź przygotowana.', en: "Browse your stylist's gallery, choose inspirations before your visit and be prepared.", de: 'Durchstöbere die Galerie deiner Stylistin, wähle Inspirationen vor deinem Besuch und sei vorbereitet.' },
      },
      finalCta: {
        headlineLine1: { pl: 'Konfiguracja zajmuje pięć minut.', en: 'Setup takes five minutes.', de: 'Die Einrichtung dauert fünf Minuten.' },
        headlineAccent: { pl: 'Potem działa sama.', en: 'Then it works on its own.', de: 'Dann funktioniert es von allein.' },
        body: { pl: 'Darmowy plan na zawsze — bez karty, bez zobowiązań. Pro za darmo przez 30 dni.', en: 'Free plan forever — no card, no commitment. Pro free for 30 days.', de: 'Kostenloser Plan für immer — keine Karte, keine Verpflichtung. Pro kostenlos für 30 Tage.' },
        pricingLink: { pl: 'Zobacz cennik', en: 'View pricing', de: 'Preise ansehen' },
        reassurance: { pl: '30 dni Pro za darmo · Anuluj kiedy chcesz', en: '30 days Pro for free · Cancel anytime', de: '30 Tage Pro kostenlos · Jederzeit kündbar' },
      },
    },
  },
};

// ─── DEEP MERGE ────────────────────────────────────────────────────

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      !('pl' in source[key] && 'en' in source[key])
    ) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      // Leaf node with translations
      // Skip if already exists
      if (target[key] === undefined) {
        target[key] = source[key];
      }
    }
  }
  return target;
}

function extractLocale(obj, locale) {
  const result = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if ('pl' in val && 'en' in val && 'de' in val) {
        result[key] = val[locale];
      } else {
        result[key] = extractLocale(val, locale);
      }
    }
  }
  return result;
}

// ─── MAIN ──────────────────────────────────────────────────────────

for (const locale of ['pl', 'en', 'de']) {
  const filePath = resolve(LOCALES_DIR, locale, 'common.json');
  const existing = JSON.parse(readFileSync(filePath, 'utf8'));
  const additions = extractLocale(NEW_KEYS, locale);
  deepMerge(existing, additions);
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  const addedCount = countLeaves(additions);
  console.log(`${locale}: merged ${addedCount} new keys into ${filePath}`);
}

function countLeaves(obj) {
  let count = 0;
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && val !== null) {
      count += countLeaves(val);
    } else {
      count++;
    }
  }
  return count;
}

console.log('Done.');
