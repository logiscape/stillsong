import { open } from '@tauri-apps/plugin-dialog';

export async function pickPhotoPath(): Promise<string | null> {
  const selection = await open({
    multiple: false,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (!selection) return null;
  return Array.isArray(selection) ? selection[0] : selection;
}
