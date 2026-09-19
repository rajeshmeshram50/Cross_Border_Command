// Trade documents raised against the PO — static until the documents API exists.
export type PoDocument = {
  code: string;
  name: string;
  /** The record the document was generated from (PO number, agreement, …). */
  ref: string;
  required: boolean;
  generatedOn: string;
  validUpTo: string;
  file: string;
  status: 'signed' | 'pending';
};

export const PO_DOCUMENTS: PoDocument[] = [
  {
    code: 'DOC/2025-26/001',
    name: 'Purchase Order',
    ref: 'PO/2025-26/001',
    required: true,
    generatedOn: '2025-01-10',
    validUpTo: '2027-01-09',
    file: 'PO_2025-26_001.pdf',
    status: 'signed',
  },
  {
    code: 'DOC/2025-26/002',
    name: 'Purchase Agreement',
    ref: 'Agreement',
    required: true,
    generatedOn: '2025-01-10',
    validUpTo: '2027-01-09',
    file: 'Purchase_Agreement_2025-26_002.pdf',
    status: 'pending',
  },
];
