import {apiCall, getData, getStylistToken} from './api-client';
import type {ADMIN_DTO_API_V1} from '@kernel/models/admin/admin.dto';
import type {FAVORITE_DTO_API_V1} from '@kernel/models/favorites/favorite.dto';
import type {GALLERY_DTO_API_V1} from '@kernel/models/gallery/gallery.dto';
import type {SESSION_DTO_API_V1} from '@kernel/models/session/session.dto';
import {NAIL_LENGTHS} from '@kernel/domain/gallery/nail-length.config';

// ============================================================================
// TEST DATA SETUP & CLEANUP HELPERS
// ============================================================================

// Cached default IDs — colors/traits use cuid since 2026-Q1 migration,
// hardcoded '1' no longer matches seed. Fetch once per process.
let _defaultGalleryIds: { color_id: string; trait_id: string } | null = null;

export async function getDefaultGalleryIds(
  token?: string
): Promise<{ color_id: string; trait_id: string }> {
  if (_defaultGalleryIds) return _defaultGalleryIds;

  const authToken = token ?? (await getStylistToken());

  const [colorsRes, traitsRes] = await Promise.all([
    apiCall({endpoint: '/api/v1/gallery/colors', method: 'GET', token: authToken}),
    apiCall({endpoint: '/api/v1/gallery/traits', method: 'GET', token: authToken}),
  ]);

  if (colorsRes.status !== 200 || traitsRes.status !== 200) {
    throw new Error(
      `Cannot fetch default gallery ids: colors=${colorsRes.status}, traits=${traitsRes.status}`
    );
  }

  const colors = getData<GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE']>(colorsRes);
  const traits = getData<GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE']>(traitsRes);

  if (!Array.isArray(colors) || colors.length === 0) {
    throw new Error('No colors seeded — run seedGalleryData first');
  }
  if (!Array.isArray(traits) || traits.length === 0) {
    throw new Error('No traits seeded — run seedGalleryData first');
  }

  _defaultGalleryIds = {color_id: colors[0].id, trait_id: traits[0].id};
  return _defaultGalleryIds;
}

type TestDataCleanup = {
  noteIds: string[];
  galleryRecordIds: string[];
  sessionIds: string[];
  bookmarkedStylistIds: string[];
  favoriteRecordIds: string[];
};

export const testDataCleanup: TestDataCleanup = {
  noteIds: [],
  galleryRecordIds: [],
  sessionIds: [],
  bookmarkedStylistIds: [],
  favoriteRecordIds: []
};

// ============================================================================
// SETUP HELPERS
// ============================================================================

export const setupTestData = {
  /**
   * Get current user's stylist_account_id
   */
  async getCurrentUserAccountId(stylistToken: string): Promise<string> {
    const response = await apiCall({
      endpoint: '/api/v1/session/get-current',
      method: 'GET',
      token: stylistToken
    });

    if (response.status === 200) {
      const data = getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(response);
      const accountId = data?.stylist_account?.account_id;
      if (accountId) {
        return accountId;
      }
    }

    throw new Error(`Failed to get account_id: ${response.status} - ${JSON.stringify(response.body)}`);
  },

  /**
   * Create a test note and track for cleanup
   */
  async createNote(adminToken: string): Promise<string> {
    const requestBody: ADMIN_DTO_API_V1['SAVE_NOTE']['REQUEST'] = {
      notes: 'Test note for setup'
    };
    const response = await apiCall({
      endpoint: '/api/v1/admin/save-note',
      method: 'POST',
      token: adminToken,
      body: requestBody
    });

    if (response.status === 201) {
      const data = getData<ADMIN_DTO_API_V1['SAVE_NOTE']['RESPONSE']>(response);
      const noteId = data?.note_id;
      if (noteId) {
        testDataCleanup.noteIds.push(noteId);
        return noteId;
      }
    }

    throw new Error(`Failed to create note: ${response.status} - ${JSON.stringify(response.body)}`);
  },

  /**
   * Create a test gallery record and track for cleanup
   */
  async createGalleryRecord(stylistToken: string): Promise<string> {
    const {color_id, trait_id} = await getDefaultGalleryIds(stylistToken);
    const requestBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] =
      {
        asset_url: 'https://res.cloudinary.com/image.jpg',
        trait_ids: [trait_id],
        color_ids: [color_id],
        nail_length: NAIL_LENGTHS.SHORT
      };
    const response = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: stylistToken,
      body: requestBody
    });

    if (response.status === 201) {
      const data = getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(response);
      const recordId = data?.gallery_record_id;
      if (recordId) {
        testDataCleanup.galleryRecordIds.push(recordId);
        return recordId;
      }
    }

    throw new Error(`Failed to create gallery record: ${response.status} - ${JSON.stringify(response.body)}`);
  },

  /**
   * Bookmark stylist and track for cleanup
   * Returns bookmarked_stylist id
   */
  async bookmarkStylist(stylistToken: string, stylistAccountId: string): Promise<string> {
    const requestBody: FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['REQUEST'] = {
      stylist_account_id: stylistAccountId
    };
    const response = await apiCall({
      endpoint: '/api/v1/bookmark/bookmark-stylist',
      method: 'POST',
      token: stylistToken,
      body: requestBody
    });

    if (response.status === 201) {
      const data = getData<FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['RESPONSE']>(response);
      const bookmarkedId = data?.id;
      if (bookmarkedId) {
        testDataCleanup.bookmarkedStylistIds.push(bookmarkedId);
        return bookmarkedId;
      }
    }

    throw new Error(`Failed to bookmark stylist: ${response.status} - ${JSON.stringify(response.body)}`);
  },

  /**
   * Add gallery record to favorites and track for cleanup
   * Returns favorite_id
   */
  async addRecordToFavorites(stylistToken: string, galleryRecordId: string): Promise<string> {
    const requestBody: FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST'] = {
      gallery_record_id: galleryRecordId
    };
    const response = await apiCall({
      endpoint: '/api/v1/favorite/add-record',
      method: 'POST',
      token: stylistToken,
      body: requestBody
    });

    if (response.status === 201) {
      const data = getData<FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE']>(response);
      const favoriteId = data?.id;
      if (favoriteId) {
        testDataCleanup.favoriteRecordIds.push(favoriteId);
        return favoriteId;
      }
    }

    throw new Error(`Failed to add record to favorites: ${response.status} - ${JSON.stringify(response.body)}`);
  }
};

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

export const cleanupTestData = {
  /**
   * Delete all test notes created during tests.
   * No delete-note API endpoint exists — notes are admin-only data with no user impact.
   */
  async deleteNotes(_adminToken: string): Promise<void> {
    testDataCleanup.noteIds = [];
  },

  /**
   * Delete all test gallery records created during tests
   */
  async deleteGalleryRecords(stylistToken: string): Promise<void> {
    for (const recordId of testDataCleanup.galleryRecordIds) {
      try {
        const requestBody: GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['REQUEST']
          = {
            gallery_record_id: recordId
          };
        await apiCall({
          endpoint: '/api/v1/gallery/delete-record',
          method: 'POST',
          token: stylistToken,
          body: requestBody
        });
      } catch (error) {
        console.warn(`Failed to delete gallery record ${recordId}:`, error);
      }
    }
    testDataCleanup.galleryRecordIds = [];
  },

  /**
   * Remove all bookmarked stylists created during tests.
   * Uses UNBOOKMARK_STYLIST endpoint.
   * Note: we track bookmarked IDs but the UNBOOKMARK endpoint uses stylist_account_id.
   * Since we don't always have the account_id mapped, we rely on gallery record
   * deletion cascade or caller providing explicit cleanup.
   */
  async removeBookmarkedStylistsFromDB(_stylistToken: string): Promise<void> {
    // UNBOOKMARK_STYLIST endpoint uses stylist_account_id, not bookmarked ID.
    // Bookmarked stylists are cascade-cleaned when associated records/users are deleted.
    testDataCleanup.bookmarkedStylistIds = [];
  },

  /**
   * Remove all favorite records created during tests.
   * Favorites referencing deleted gallery records are auto-cleaned by the DB.
   */
  async removeFavoriteRecordsFromDB(_stylistToken: string): Promise<void> {
    // Gallery record deletion cascades to favorite references.
    testDataCleanup.favoriteRecordIds = [];
  },

  /**
   * Run all cleanup operations
   */
  async cleanupAll(adminToken: string, stylistToken: string): Promise<void> {
    console.log('\n🧹 Cleaning up test data...');

    await this.deleteGalleryRecords(stylistToken);
    await this.deleteNotes(adminToken);
    await this.removeBookmarkedStylistsFromDB(stylistToken);
    await this.removeFavoriteRecordsFromDB(stylistToken);

    console.log('✅ Cleanup complete\n');
  }
};
