'use client'
import { useState } from 'react'
import Modal from '../Modal'
import styles from './SettingModal.module.scss'
import classNames from 'classnames'
import type { Navigation } from '@/components/NavigationBar/NavigationBar'
import Appearance from '@/svg/Appearance'
import Bell from '@/svg/Bell'
import User from '@/svg/User'
import Workspace from '@/svg/Workspace'
import NavigationItem from '@/components/NavigationItem/NavigationItem'
import ThemeToggle from '@/components/ThemeToggle/ThemeToggle'
import useStyleStore from '@/app/store/useStyleStore'

const settingList:Navigation[] = [
    {title: 'Appearance', href: undefined, svg: <Appearance /> },
    {title: 'Notifications', href: undefined, svg: <Bell /> },
    {title: 'Account', href: undefined, svg: <User /> },
    {title: 'Workspace', href: undefined, svg: <Workspace /> }
]

interface Props {
    open: boolean
    closeFn: () => void
}

const SettingModal = ({open, closeFn}: Props) => {
    const [activeTab, setActiveTab] = useState('Appearance')
    const [emailNotifications, setEmailNotifications] = useState(true)
    const [appNotifications, setAppNotifications] = useState(true)
    const theme = useStyleStore(state => state.theme)
    const toggleTheme = useStyleStore(state => state.toggleTheme)

    return (
        <Modal isOpen={open} shadow closeFn={closeFn}>
            <div className={classNames(styles.container)}>
                <aside className={classNames(styles.aside)}>
                    <div className={classNames(styles.header)}>
                        设置
                    </div>
                    <div className={classNames(styles.list)}>
                        {
                            settingList.map((item, i) => 
                                <div 
                                    key={i}
                                    className={classNames(styles.asideItem, activeTab === item.title && styles.active)}
                                    onClick={() => setActiveTab(item.title)}
                                >
                                    <NavigationItem 
                                        title={item.title} 
                                        svg={item.svg} 
                                    />
                                </div>
                            )
                        }
                    </div>
                </aside>
                <main className={classNames(styles.content)}>
                    {activeTab === 'Appearance' && (
                        <div className={classNames(styles.section)}>
                            <h2 className={classNames(styles.sectionTitle)}>外观</h2>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>深色模式</span>
                                <ThemeToggle 
                                    checked={theme === 'dark'} 
                                    onChange={() => toggleTheme(theme === 'light' ? 'dark' : 'light')} 
                                    isThemeToggle={true}
                                />
                            </div>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>字体大小</span>
                                <select className={classNames(styles.settingSelect)} defaultValue="medium">
                                    <option value="small">小</option>
                                    <option value="medium">中</option>
                                    <option value="large">大</option>
                                </select>
                            </div>
                        </div>
                    )}
                    {activeTab === 'Notifications' && (
                        <div className={classNames(styles.section)}>
                            <h2 className={classNames(styles.sectionTitle)}>通知</h2>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>邮件通知</span>
                                <ThemeToggle 
                                    checked={emailNotifications} 
                                    onChange={() => setEmailNotifications(pre => !pre)} 
                                    isThemeToggle={false}
                                />
                            </div>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>应用通知</span>
                                <ThemeToggle 
                                    checked={appNotifications} 
                                    onChange={() => setAppNotifications(pre => !pre)} 
                                    isThemeToggle={false}
                                />
                            </div>
                        </div>
                    )}
                    {activeTab === 'Account' && (
                        <div className={classNames(styles.section)}>
                            <h2 className={classNames(styles.sectionTitle)}>账户</h2>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>用户名</span>
                                <span className={classNames(styles.settingValue)}>demo_user</span>
                            </div>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>邮箱</span>
                                <span className={classNames(styles.settingValue)}>demo@example.com</span>
                            </div>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>修改密码</span>
                                <button className={classNames(styles.settingButton)}>修改</button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'Workspace' && (
                        <div className={classNames(styles.section)}>
                            <h2 className={classNames(styles.sectionTitle)}>工作区</h2>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>工作区名称</span>
                                <span className={classNames(styles.settingValue)}>Demo Workspace</span>
                            </div>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>成员数量</span>
                                <span className={classNames(styles.settingValue)}>1</span>
                            </div>
                            <div className={classNames(styles.settingItem)}>
                                <span className={classNames(styles.settingLabel)}>存储空间</span>
                                <span className={classNames(styles.settingValue)}>1.2 GB / 10 GB</span>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </Modal>
    )
}

export default SettingModal