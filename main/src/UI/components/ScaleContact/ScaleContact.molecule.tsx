import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../Button/LinkButton.atom';
import styles from './ScaleContact.module.css';

export function ScaleContactMolecule({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: string;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.body}>
        <h3 className={styles.name}>{title}</h3>
        <p className={styles.description}>{description}</p>
      </div>
      <LinkButtonAtom variant='outlined' size='md' href={ROUTES_FRONT.CONTACT}>
        {action}
      </LinkButtonAtom>
    </div>
  );
}
