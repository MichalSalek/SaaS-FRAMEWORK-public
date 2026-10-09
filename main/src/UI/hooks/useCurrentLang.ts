import { useRouter } from 'next/router';

export const useCurrentLang = (): string => useRouter().locale ?? 'pl';
