import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';
import { Camera, Save, LogOut, ShieldCheck } from 'lucide-react';

export default function Profile() {
  const { user, logout } = useAuth();
  const toast = useToast();
  if (!user) return null;

  return (
    <div>
      <h1 className="text-[17px] font-bold text-text tracking-tight mb-4">Profile & Settings</h1>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-5">
        {/* Left - Avatar Card */}
        <Card>
          <CardBody className="text-center !py-8">
            <div className="w-24 h-24 rounded-full border-[3px] border-dashed border-border mx-auto mb-4 flex items-center justify-center cursor-pointer hover:border-primary/40 transition-colors">
              <Avatar initials={user.initials} size="lg" />
            </div>
            <div className="text-[17px] font-bold text-text">{user.name}</div>
            <div className="text-[13px] text-secondary mt-1">{user.user_type.replace(/_/g, ' ')}</div>
            <div className="mt-4"><Badge variant="success" dot>Active</Badge></div>
            <div className="mt-5 pt-5 border-t border-border">
              <Button variant="danger" size="sm" className="w-full justify-center" onClick={() => { toast.info('Logged Out', 'You have been signed out'); logout(); }}>
                <LogOut size={13} /> Logout
              </Button>
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          {/* Personal Info */}
          <Card>
            <CardHeader><span className="text-[13px] font-bold text-text">Personal Information</span></CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Full Name" defaultValue={user.name} />
                <Input label="Email" defaultValue={user.email} />
                <Input label="Phone" defaultValue="+91 9876543210" />
                <Input label="Timezone" defaultValue="Asia/Kolkata (IST)" />
              </div>
              <div className="flex justify-end mt-4">
                <Button><Save size={13} /> Update Profile</Button>
              </div>
            </CardBody>
          </Card>

          {/* Change Password */}
          <Card>
            <CardHeader>
              <span className="text-[13px] font-bold text-text flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-amber-500" /> Change Password
              </span>
            </CardHeader>
            <CardBody>
              <Input label="Current Password" type="password" placeholder="Enter current password" className="mb-4" />
              <div className="grid grid-cols-2 gap-4">
                <Input label="New Password" type="password" placeholder="Enter new password" />
                <Input label="Confirm Password" type="password" placeholder="Confirm new password" />
              </div>
              <div className="flex justify-end mt-4">
                <Button><Save size={13} /> Change Password</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
