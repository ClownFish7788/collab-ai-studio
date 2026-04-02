'use client'

import classNames from "classnames"
import styles from './Switch.module.scss'
import Edgeless from "@/svg/Edgeless"
import Doc from "@/svg/Doc"
import { useRouter, useSearchParams } from "next/navigation"


const EDGELESS = 'edgeless'
const DOC = 'doc'

const Switch = () => {
    const router = useRouter()
    const searchParams = useSearchParams()
    const mode = searchParams.get('mode')
    const handleNavigate = (mode:string) => {
        router.push(`?mode=${mode}`)
        
    }
    return (
        <div className={classNames(styles.container)}>
            <div className={classNames(styles.block, mode === EDGELESS && styles.edge)}></div>
            <div className={classNames(styles.doc)} onClick={() => handleNavigate(DOC)}>
                <Doc />
            </div>
            <div className={classNames(styles.edgeless)} onClick={() => handleNavigate(EDGELESS)}>
                <Edgeless />
            </div>
        </div>
    )
}

export default Switch