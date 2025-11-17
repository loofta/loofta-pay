import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUnlockCreators } from "@/hooks/useUnlockCreators";
import { Loader2 } from "lucide-react";
import { UNLOCK_CREATORS_ACCESS_AMOUNT } from '@/lib/utils';

interface UnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  userData: any;
}

export function UnlockModal({ isOpen, onClose, userData }: UnlockModalProps) {
  const { handleConfirmPayment, isLoading } = useUnlockCreators();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Unlock Creator Access</DialogTitle>
          <DialogDescription>
            Pay {UNLOCK_CREATORS_ACCESS_AMOUNT} USDT to unlock access to our verified creators list for 1 year.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <p className="text-sm text-muted-foreground">
            By proceeding, you will gain access to our exclusive list of verified creators and KOLs.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={() => handleConfirmPayment('taraxa', 'USDT')}
            disabled={isLoading}
            className="bg-primary hover:bg-primary/90"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Confirm Payment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 