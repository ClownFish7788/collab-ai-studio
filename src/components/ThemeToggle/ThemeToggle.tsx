'use client'

import classNames from "classnames"
import styles from './ThemeToggle.module.scss'

interface ThemeToggleProps {
    checked: boolean
    onChange: () => void
    isThemeToggle?: boolean
}

const ThemeToggle = ({ checked, onChange, isThemeToggle = false }: ThemeToggleProps) => {

    return (
        <div 
            className={classNames(styles.themeToggleContainer, isThemeToggle && styles.themeToggleContainerTheme)}
            onClick={onChange}
        >
            <div className={classNames(
                styles.themeToggleTrack, 
                checked && styles.themeToggleTrackActive,
                isThemeToggle && styles.themeToggleTrackTheme,
                checked && !isThemeToggle && styles.themeToggleTrackNotificationActive
            )}>
                <div 
                    className={classNames(
                        styles.themeToggleThumb, 
                        isThemeToggle && styles.themeToggleThumbTheme,
                        checked && (isThemeToggle ? styles.themeToggleThumbActive : styles.themeToggleThumbNotificationActive)
                    )}
                ></div>
                {isThemeToggle && (
                    <div className={classNames(styles.themeToggleIcons)}>
                        <div className={classNames(styles.moonIcon)}>
                            🌙
                        </div>
                        <div className={classNames(styles.sunIcon)}>
                            ☀️
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default ThemeToggle