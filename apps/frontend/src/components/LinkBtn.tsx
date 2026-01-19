import classNames from "classnames";
import { Button } from "./ui/button";
import { LucideIcon } from "lucide-react";

interface LinkBtnProps {
    text: string;
    icon?: LucideIcon;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: any;
    customProperties?: string;
}

export default function LinkBtn({ text, icon: Icon, onClick, disabled, customProperties, ...rest }: LinkBtnProps) {
    return (
        <Button
            onClick={onClick}
            disabled={disabled}
            {...rest}
            className={classNames(
                'p-2 hover:bg-gray-50 bg-white w-full rounded-[calc(0.8rem-2px)] text-base font-medium text-gray-900 text-opacity-100 hover:text-opacity-100',
                customProperties
            )}
        >
            {Icon && <Icon className="w-5 h-5 mr-2" />}
            {text}
        </Button>
    );
}
