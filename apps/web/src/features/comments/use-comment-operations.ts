import { useLayoutEffect, useState } from "react";
import { confirmAction } from "@/components/feedback";
import { createCommentRecord, deleteCommentRecord, setCommentReactionRecord, updateCommentRecord } from "./api";
import { createCommentOperations, type CommentOperationsInput } from "./operations";

export function useCommentOperations(input: CommentOperationsInput) {
  const [operations] = useState(() =>
    createCommentOperations(input, {
      create: createCommentRecord,
      update: updateCommentRecord,
      remove: deleteCommentRecord,
      react: setCommentReactionRecord,
      confirmDelete: confirmAction,
    }),
  );
  // Synchronize committed scope before events and invalidate pending requests
  // on unmount. Re-synchronizing also supports Strict Mode effect replay.
  useLayoutEffect(() => {
    operations.synchronize(input);
  });
  useLayoutEffect(() => () => operations.dispose(), [operations]);
  return operations;
}
