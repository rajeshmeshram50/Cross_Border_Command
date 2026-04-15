import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Avatar from '../components/ui/Avatar';
import { Table, Td } from '../components/ui/Table';
import { Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';

const users = [
  { name: 'Durgesh Urkude', email: 'durgesh@inorbvict.com', role: 'Sales Manager', status: 'active', branch: 'Inorbvict Agrotech' },
  { name: 'Ankit Bhosale', email: 'ankit@inorbvict.com', role: 'Purchase Manager', status: 'active', branch: 'RM Agro East' },
  { name: 'Priti Shende', email: 'priti@inorbvict.com', role: 'Accounts Manager', status: 'active', branch: 'Inorbvict Agrotech' },
  { name: 'Sandeep Kadu', email: 'sandeep@inorbvict.com', role: 'Logistics Manager', status: 'active', branch: 'RM Trading West' },
  { name: 'Pooja Lokhande', email: 'pooja@inorbvict.com', role: 'Intern', status: 'inactive', branch: 'Inorbvict Agrotech' },
];

export default function UsersPage() {
  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Branch Users</h1>
          <p className="text-[11.5px] text-muted mt-0.5">{users.length} users across branches</p>
        </div>
        <Button size="sm"><Plus size={13} /> Add User</Button>
      </div>

      <Table headers={['Name', 'Email', 'Branch', 'Role', 'Status', 'Actions']}>
        {users.map(u => (
          <tr key={u.email} className="hover:bg-primary/5 transition-colors">
            <Td>
              <div className="flex items-center gap-2.5">
                <Avatar initials={u.name.split(' ').map(w => w[0]).join('')} size="sm" />
                <strong className="text-text">{u.name}</strong>
              </div>
            </Td>
            <Td>{u.email}</Td>
            <Td>{u.branch}</Td>
            <Td><Badge variant="primary">{u.role}</Badge></Td>
            <Td><Badge variant={u.status === 'active' ? 'success' : 'muted'} dot>{u.status}</Badge></Td>
            <Td>
              <div className="flex gap-1">
                {[Pencil, Trash2, ShieldCheck].map((I, j) => (
                  <button key={j} className="w-6 h-6 rounded-md border border-border bg-surface text-muted flex items-center justify-center hover:text-primary hover:border-primary/40 transition-all">
                    <I size={11} />
                  </button>
                ))}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
