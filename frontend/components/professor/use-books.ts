import { api, type Book } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';

const POLL_MS = 2000;

function processing(book: Book) {
  return book.file?.status === 'processing' || book.pending_file?.status === 'processing';
}

/** A subject's books, refreshed while an upload is still being converted. */
export function useBooks(subjectId: number) {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBooks(await api.books(subjectId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [subjectId]);

  useEffect(() => {
    setBooks(null);
    refresh();
  }, [refresh]);

  const busy = books?.some(processing) ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  const replace = useCallback((book: Book) => {
    setBooks((current) => {
      if (!current) return [book];
      return current.some((b) => b.id === book.id) ? current.map((b) => (b.id === book.id ? book : b)) : [...current, book];
    });
  }, []);

  const replaceAll = useCallback((next: Book[]) => setBooks(next), []);
  const remove = useCallback((bookId: number) => setBooks((current) => current?.filter((b) => b.id !== bookId) ?? null), []);

  return { books, error, refresh, replace, replaceAll, remove };
}
