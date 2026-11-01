/**
 * A browser's own page translation (Chrome, Safari, Edge) swaps each text
 * node for a <font> of its own. React still holds the old node, and when it
 * later removes it, or inserts next to it, the DOM throws NotFoundError and
 * the whole screen falls to the error page: the place picker's 「ここで保存」
 * did, right after the photo was saved. Here a node that is no longer where
 * React thinks it is is left alone instead. The translated text may then
 * stay as it was until the next screen, which is better than no screen.
 * https://github.com/facebook/react/issues/11538
 */
if (typeof Node === "function" && Node.prototype) {
  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return removeChild.call(this, child) as T;
  };
  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, before: Node | null): T {
    if (before && before.parentNode !== this) return node;
    return insertBefore.call(this, node, before) as T;
  };
}

export {};
