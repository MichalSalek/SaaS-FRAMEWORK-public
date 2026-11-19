import { useState } from 'react';
import { KeepTogetherTextAtom } from '../../components/KeepTogetherText/KeepTogetherText.atom';
import { CheckIcon } from '@phosphor-icons/react';
import { DisclosureMolecule } from '../../components/Disclosure/Disclosure.molecule';
import styles from './AccountPayPage.module.css';

export function PlanFeatureListOrganism({
  features,
}: {
  features: readonly string[];
}) {
  return (
    <ul className={styles.featureList}>
      {features.map(feature => (
        <li key={feature} className={styles.featureItem}>
          <CheckIcon
            size={16}
            weight='bold'
            className={styles.featureCheck}
            aria-hidden='true'
          />
          <span>
            <KeepTogetherTextAtom>{feature}</KeepTogetherTextAtom>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PlanFeatureDisclosureOrganism({
  features,
  showLabel,
  hideLabel,
}: {
  features: readonly string[];
  showLabel: string;
  hideLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DisclosureMolecule
      title={open ? hideLabel : showLabel}
      open={open}
      onOpenChange={setOpen}
      surface='plain'
      headingAs='h3'
      className={styles.planFeaturesDisclosure}>
      <PlanFeatureListOrganism features={features} />
    </DisclosureMolecule>
  );
}
