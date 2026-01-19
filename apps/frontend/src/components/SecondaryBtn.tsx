import classNames from "classnames";
import { Button } from "./ui/button";
import { LucideIcon } from "lucide-react";

interface SecondaryBtnProps {
    text: string;
    icon?: LucideIcon;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: any;
    customProperties?: string;
}

export default function SecondaryBtn({ text, icon: Icon, onClick, disabled, customProperties, ...rest }: SecondaryBtnProps) {
    return (
        <div className="rounded-xl p-px bg-gradient-to-b disabled:opacity-50 from-[#FF0F00] to-yellow-500">
            <Button
                onClick={onClick}
                disabled={disabled}
                {...rest}
                className={classNames(
                    'p-2 hover:bg-gray-50 bg-white w-full rounded-[calc(0.8rem-2px)] text-base font-medium text-[#FF0F00] hover:text-opacity-100 disabled:bg-white disabled:text-opacity-60 disabled:opacity-100 ',
                    customProperties
                )}
            >
                {Icon && <Icon className="w-5 h-5 mr-2" />}
                {text}
            </Button>
        </div>
    );
}
