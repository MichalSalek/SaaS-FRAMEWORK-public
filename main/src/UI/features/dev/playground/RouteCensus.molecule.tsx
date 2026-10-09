import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { resolveRouteAccessCategory } from '../../../../application/policies/route-access.policy';

const groups = [
  'Publiczne',
  'Logowanie i konto',
  'Aplikacja mobilna',
  'Administracja',
] as const;
function group(path: string): (typeof groups)[number] {
  if (path.startsWith(ROUTES_FRONT.ADMIN)) {
    return 'Administracja';
  }
  const category = resolveRouteAccessCategory(path);
  if (category === 'account-route') {
    return 'Logowanie i konto';
  }
  return category === 'product-route' ? 'Aplikacja mobilna' : 'Publiczne';
}

/** Discovery stays tied to the routing and desktop access sources of truth. */
export function RouteCensusMolecule() {
  const routes = Object.entries(ROUTES_FRONT);
  return (
    <div>
      <p>
        {routes.length} tras z rejestru routingu. Lista określa zakres
        rozpoznania, nie oznacza testu każdego przepływu.
      </p>
      {groups.map(name => {
        const entries = routes.filter(([, path]) => group(path) === name);
        return (
          <details key={name}>
            <summary>
              {name} ({entries.length})
            </summary>
            <ul>
              {entries.map(([key, path]) => (
                <li key={key}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
