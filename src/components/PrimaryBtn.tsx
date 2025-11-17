import classNames from "classnames";
import { Button } from "./ui/button";
import { LucideIcon } from "lucide-react";

interface PrimaryBtnProps {
    text: string;
    onClick?: () => void;
    disabled?: boolean;
    icon?: LucideIcon;
    [key: string]: any;
    customProperties?: string;
}

export default function PrimaryBtn({ text, icon: Icon, onClick, disabled, customProperties, ...rest }: PrimaryBtnProps) {
    return (
        <Button
            type="button"
            onClick={onClick}
            disabled={disabled}
            {...rest}
            className={classNames(
                'py-6 rounded-xl w-full px-3 bg-gradient-to-r my-4 from-[#FF0F00] to-yellow-500 text-white text-base font-medium disabled:brightness-90 hover:brightness-105 shadow-lg backdrop-blur-md',
                customProperties
            )}
        >
            {Icon && <Icon className="w-5 h-5 mr-2" />}
            {text}
        </Button>
    );
}

