import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * True while the IME still has a conversion open.
 *
 * 日本語は IME を通って入ってきます。打った音が読みとして溜まり、Enter で確定
 * します。その Enter はページにも届きます - 本物の keydown として、key は
 * "Enter"、keyCode は 13 のまま。つまり「確定の Enter」と「改行の Enter」は
 * キーとしては見分けがつかず、`isComposing` だけが違います。
 *
 * 見分けずに扱うと、箇条書きでは「りんご」を確定した時点で次の項目が足され、
 * 続けて押した本物の Enter でもう一つ足されます。入力欄では、まだ読みの途中
 * だったものが確定として送られます。
 *
 * keyCode 229 は同じ状態の古い伝え方です（この場合 key は "Process" になり、
 * そもそも Enter として一致しません）。見ておいても害はないので添えています。
 */
export function converting(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  const key = 'nativeEvent' in event ? event.nativeEvent : event
  return key.isComposing || key.keyCode === 229
}
