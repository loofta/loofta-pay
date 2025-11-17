import classNames from "classnames";

interface SubTitleProps {
    text: string;
    customProperties?: string;
}

export default function Subtitle({ text, customProperties }: SubTitleProps) {
    return (
        <h3 className={classNames('font-display font-normal text-xl leading-tight opacity-50', customProperties)}>{text}</h3>
    )
}