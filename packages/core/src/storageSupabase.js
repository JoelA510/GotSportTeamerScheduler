/**
 * Upload a file to Supabase Storage.
 *
 * @param {Object} params
 * @param {Object} params.supabaseClient - Supabase client.
 * @param {string} params.bucket - Storage bucket name (e.g., 'exports').
 * @param {string} params.path - File path within the bucket.
 * @param {string|Blob|File} params.file - File content.
 * @param {string} [params.contentType] - MIME type (default: 'text/csv').
 * @returns {Promise<Object>} { data, error }
 */
export async function uploadScheduleExport({
  supabaseClient,
  bucket = 'exports',
  path,
  file,
  contentType = 'text/csv',
}) {
  if (!supabaseClient || typeof supabaseClient.storage !== 'object') {
    throw new TypeError('supabaseClient with storage support is required');
  }
  if (!path) {
    throw new Error('Upload path is required');
  }
  if (!file) {
    throw new Error('File content is required');
  }

  const { data, error } = await supabaseClient.storage.from(bucket).upload(path, file, {
    contentType,
    upsert: true,
  });

  if (error) {
    console.error('Upload failed:', error);
    throw new Error(`Failed to upload ${path}: ${error.message}`);
  }

  return { data, error: null };
}
