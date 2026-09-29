/**
 * The CLM pages' "+N" popovers share their dismiss rules with the Sales ones, so
 * the hook itself lives in hooks/. This keeps the CLM import path, and with it
 * the `.clm-pop` default those pages rely on.
 */
export { default } from '../../../hooks/useDismissPopover';
