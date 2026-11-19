type PersonPhoto = {
  avatar_url?: string | null;
  image?: string | null;
};

/** Custom person photo first; the provider image remains an independent fallback. */
export function personAvatarSources(person: PersonPhoto): readonly string[] {
  return [
    ...new Set(
      [person.avatar_url, person.image].filter(
        (url): url is string => typeof url === 'string' && url.trim() !== ''
      )
    ),
  ];
}

export function resolvePersonAvatarUrl(person: PersonPhoto): string | null {
  return personAvatarSources(person)[0] ?? null;
}
