/*
 * templates.ts - blank layouts for learning a remote from scratch.
 *
 * Used when the database has nothing for a remote, or when the user would
 * rather just press buttons. The canonical names are what matter: they let a
 * keymap preset fill in automatically once the codes are learned.
 */
import { buttonIdFor, newId, type RemoteButton, type RemoteProfile } from './types';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  /** [canonicalName, label, row, col] */
  buttons: [string, string, number, number][];
}

export const TEMPLATES: LayoutTemplate[] = [
  {
    id: 'minimal',
    name: 'Minimal (9 buttons)',
    description: 'Just navigation and volume. Quickest to set up.',
    buttons: [
      ['up', 'Up', 0, 1],
      ['left', 'Left', 1, 0],
      ['ok', 'OK', 1, 1],
      ['right', 'Right', 1, 2],
      ['down', 'Down', 2, 1],
      ['back', 'Back', 3, 0],
      ['vol_down', 'Vol −', 3, 1],
      ['vol_up', 'Vol +', 3, 2],
      ['power', 'Power', 4, 1],
    ],
  },
  {
    id: 'media',
    name: 'Media remote (21 buttons)',
    description: 'Navigation, transport and volume. Suits a media centre PC.',
    buttons: [
      ['power', 'Power', 0, 0],
      ['home', 'Home', 0, 2],
      ['menu', 'Menu', 0, 3],
      ['up', 'Up', 1, 1],
      ['left', 'Left', 2, 0],
      ['ok', 'OK', 2, 1],
      ['right', 'Right', 2, 2],
      ['down', 'Down', 3, 1],
      ['back', 'Back', 3, 3],
      ['info', 'Info', 3, 0],
      ['rewind', 'Rewind', 4, 0],
      ['play_pause', 'Play / Pause', 4, 1],
      ['fast_forward', 'Forward', 4, 2],
      ['stop', 'Stop', 4, 3],
      ['prev', 'Previous', 5, 0],
      ['next', 'Next', 5, 1],
      ['mute', 'Mute', 5, 2],
      ['vol_up', 'Vol +', 6, 0],
      ['vol_down', 'Vol −', 6, 1],
      ['ch_up', 'Ch +', 6, 2],
      ['ch_down', 'Ch −', 6, 3],
    ],
  },
  {
    id: 'tv',
    name: 'TV remote (38 buttons)',
    description: 'A full TV layout including the number pad and colour keys.',
    buttons: [
      ['power', 'Power', 0, 0],
      ['source', 'Source', 0, 3],
      ['num_1', '1', 1, 0],
      ['num_2', '2', 1, 1],
      ['num_3', '3', 1, 2],
      ['num_4', '4', 2, 0],
      ['num_5', '5', 2, 1],
      ['num_6', '6', 2, 2],
      ['num_7', '7', 3, 0],
      ['num_8', '8', 3, 1],
      ['num_9', '9', 3, 2],
      ['num_0', '0', 4, 1],
      ['vol_up', 'Vol +', 5, 0],
      ['mute', 'Mute', 5, 1],
      ['ch_up', 'Ch +', 5, 2],
      ['vol_down', 'Vol −', 6, 0],
      ['guide', 'Guide', 6, 1],
      ['ch_down', 'Ch −', 6, 2],
      ['home', 'Home', 7, 0],
      ['menu', 'Menu', 7, 1],
      ['info', 'Info', 7, 2],
      ['up', 'Up', 8, 1],
      ['left', 'Left', 9, 0],
      ['ok', 'OK', 9, 1],
      ['right', 'Right', 9, 2],
      ['down', 'Down', 10, 1],
      ['back', 'Back', 11, 0],
      ['exit', 'Exit', 11, 2],
      ['red', 'Red', 12, 0],
      ['green', 'Green', 12, 1],
      ['yellow', 'Yellow', 12, 2],
      ['blue', 'Blue', 12, 3],
      ['rewind', 'Rewind', 13, 0],
      ['play_pause', 'Play / Pause', 13, 1],
      ['fast_forward', 'Forward', 13, 2],
      ['stop', 'Stop', 13, 3],
      ['subtitle', 'Subtitle', 14, 0],
      ['audio', 'Audio', 14, 1],
    ],
  },
];

export function profileFromTemplate(
  t: LayoutTemplate,
  protocol: number,
  address: number,
  name: string
): RemoteProfile {
  const taken = new Set<string>();
  const buttons: RemoteButton[] = t.buttons.map(([canon, label, row, col]) => ({
    id: buttonIdFor(canon, taken),
    label,
    canon,
    row,
    col,
    key: null, // learned by pressing
  }));

  return {
    id: newId('profile'),
    name,
    protocol,
    address,
    source: 'template',
    buttons,
    updated: new Date().toISOString(),
  };
}
