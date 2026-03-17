"use client"

import { Manrope } from "next/font/google"

import styles from "./clean-control.module.css"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

export default function CleanControlPage() {
  return (
    <div className={`${styles.page} ${manrope.className}`}>
      <div className={styles.phoneContainer}>
        <div className={styles.phoneLabel}>PANTALLA 1: LOGIN</div>
        <div className={styles.phone}>
          <div className={`${styles.screen} ${styles.loginScreen}`}>
            <div className={styles.logoContainer}>
              <div className={styles.logoIcon}>🧼✨</div>
              <div className={styles.logoText}>CLEAN CONTROL</div>
              <div className={styles.logoSubtitle}>Control de Aseo Pro</div>
            </div>

            <div className={styles.inputGroup}>
              <div className={styles.inputField}>
                <span className={styles.inputIcon}>📧</span>
                <span>maria.gonzalez@email.com</span>
              </div>
            </div>

            <div className={styles.inputGroup}>
              <div className={styles.inputField}>
                <span className={styles.inputIcon}>🔒</span>
                <span>••••••••</span>
              </div>
            </div>

            <button className={styles.btnPrimary}>INGRESAR →</button>

            <a href="#" className={styles.forgotPassword}>
              ¿Olvidaste tu contraseña?
            </a>
          </div>
        </div>
      </div>

      <div className={styles.phoneContainer}>
        <div className={styles.phoneLabel}>PANTALLA 2: HUB PRINCIPAL</div>
        <div className={styles.phone}>
          <div className={styles.screen}>
            <div className={styles.hubHeader}>
              <div className={styles.userGreeting}>👋 Hola, María</div>
              <div className={styles.userStatus}>
                <span className={styles.statusDot} />
                <span>En línea • Listo para trabajar</span>
              </div>
            </div>

            <div className={styles.hubContent}>
              <button className={`${styles.btnMega} ${styles.btnStart}`}>
                <span className={styles.btnStartIcon}>▶️</span>
                <span className={styles.btnStartText}>
                  INICIAR
                  <br />
                  TURNO
                </span>
              </button>

              <button className={`${styles.btnMega} ${styles.btnProfile}`}>
                <span className={styles.btnProfileIcon}>👤</span>
                <span className={styles.btnProfileText}>Ver mi perfil</span>
              </button>

              <button className={`${styles.btnMega} ${styles.btnLogout}`}>
                <span>🚪</span>
                <span>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.phoneContainer}>
        <div className={styles.phoneLabel}>PANTALLA 3: INICIAR TURNO</div>
        <div className={styles.phone}>
          <div className={styles.screen}>
            <div className={styles.screenHeader}>
              <div className={styles.headerNav}>
                <a href="#" className={styles.backBtn}>
                  ←
                </a>
                <span className={styles.headerTitle}>Iniciar Turno</span>
                <span className={styles.helpLink}>Ayuda</span>
              </div>
            </div>

            <div className={styles.scrollContent}>
              <div className={styles.greetingCard}>
                <div className={styles.greetingName}>¡Hola, María! 👋</div>
                <div className={styles.shiftInfo}>
                  <div className={styles.infoRow}>📅 Miércoles 15 de Marzo</div>
                  <div className={styles.infoRow}>⏰ 08:00 - 12:00 (4 horas)</div>
                  <div className={styles.infoRow}>📍 Restaurante "El Buen Sabor"</div>
                </div>
              </div>

              <div className={styles.sectionTitle}>🎯 Tareas Especiales</div>
              <div className={styles.tasksCard}>
                <div className={styles.taskItem}>
                  <span>⚠️</span>
                  <span>Limpiar campana extractora</span>
                </div>
                <div className={styles.taskItem}>
                  <span>⚠️</span>
                  <span>Desinfectar área de cajas</span>
                </div>
              </div>

              <div className={styles.sectionTitle}>Requisitos</div>
              <div className={styles.requirementsGrid}>
                <div className={styles.reqItem}>
                  <div className={styles.reqIcon}>📍</div>
                  <div className={styles.reqLabel}>GPS</div>
                  <div className={styles.reqStatus}>✅ Activo</div>
                </div>
                <div className={styles.reqItem}>
                  <div className={styles.reqIcon}>📷</div>
                  <div className={styles.reqLabel}>Cámara</div>
                  <div className={styles.reqStatus}>✅ Lista</div>
                </div>
              </div>

              <div className={styles.certificateCard}>
                <span className={styles.certIcon}>📋</span>
                <div className={styles.certInfo}>
                  <div className={styles.certTitle}>Certificado de Aptitud</div>
                  <div className={styles.certDate}>✅ Vigente hasta 15/06/2026</div>
                </div>
              </div>
            </div>

            <div className={styles.bottomAction}>
              <button className={styles.btnFull}>▶️ INICIAR TURNO</button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.phoneContainer}>
        <div className={styles.phoneLabel}>PANTALLA 4: FOTOS INGRESO</div>
        <div className={styles.phone}>
          <div className={styles.screen}>
            <div className={styles.progressHeader}>
              <div className={styles.headerNav} style={{ marginBottom: 15 }}>
                <a href="#" className={styles.backBtn}>
                  ←
                </a>
                <span style={{ color: "#64748B", fontSize: 14, fontWeight: 600 }}>Paso 1 de 4</span>
              </div>
              <div className={styles.progressBar}>
                <div className={`${styles.progressDot} ${styles.progressDotActive}`} />
                <div className={styles.progressDot} />
                <div className={styles.progressDot} />
                <div className={styles.progressDot} />
              </div>
              <div className={styles.stepTitle}>📸 Fotos de Ingreso</div>
            </div>

            <div className={styles.cameraContainer}>
              <div className={styles.areaSelector}>
                <span>🏠 Área: Cocina Principal</span>
                <span>▼</span>
              </div>

              <div className={styles.cameraViewfinder}>
                <div className={styles.cameraPlaceholder}>
                  <div className={styles.cameraIcon}>📷</div>
                  <div className={styles.cameraText}>Toca para capturar</div>
                </div>
                <div className={styles.shutterBtn} />
              </div>

              <div className={styles.thumbnailsRow}>
                <div className={styles.thumb}>
                  <div className={styles.thumbCheck}>✓</div>
                  <span>✓</span>
                  <span style={{ fontSize: 10 }}>Cocina</span>
                </div>
                <div className={styles.thumb}>
                  <div className={styles.thumbCheck}>✓</div>
                  <span>✓</span>
                  <span style={{ fontSize: 10 }}>Baño</span>
                </div>
                <div className={`${styles.thumb} ${styles.thumbAdd}`}>
                  <span style={{ fontSize: 24 }}>+</span>
                </div>
              </div>

              <button className={styles.btnFull} style={{ marginBottom: 20 }}>
                ✅ LISTO - SIGUIENTE
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.phoneContainer}>
        <div className={styles.phoneLabel}>PANTALLA 5: EN LIMPIEZA</div>
        <div className={styles.phone}>
          <div className={`${styles.screen} ${styles.cleaningScreen}`}>
            <div className={styles.cleaningEmoji}>🧽✨🧹</div>
            <div className={styles.cleaningTitle}>¡LIMPIANDO!</div>
            <div className={styles.cleaningLocation}>"El Buen Sabor"</div>

            <div className={styles.timerDisplay}>01:23:45</div>
            <div className={styles.timerLabel}>Tiempo transcurrido</div>

            <button className={styles.btnFinishCleaning}>✅ TERMINÉ DE LIMPIAR</button>

            <div className={styles.cleaningTip}>
              💡 Mantén la app abierta mientras trabajas. Los datos se guardan automáticamente.
            </div>
          </div>
        </div>
      </div>

      <div className={styles.phoneContainer}>
        <div className={styles.phoneLabel}>PANTALLA 6: FINALIZAR</div>
        <div className={styles.phone}>
          <div className={styles.screen}>
            <div className={styles.progressHeader}>
              <div className={styles.headerNav} style={{ marginBottom: 15 }}>
                <a href="#" className={styles.backBtn}>
                  ←
                </a>
                <span style={{ color: "#64748B", fontSize: 14, fontWeight: 600 }}>Paso 4 de 4</span>
              </div>
              <div className={styles.progressBar}>
                <div className={`${styles.progressDot} ${styles.progressDotCompleted}`} />
                <div className={`${styles.progressDot} ${styles.progressDotCompleted}`} />
                <div className={`${styles.progressDot} ${styles.progressDotCompleted}`} />
                <div className={`${styles.progressDot} ${styles.progressDotActive}`} />
              </div>
              <div className={styles.stepTitle}>✅ Finalizar Turno</div>
            </div>

            <div className={styles.formContent}>
              <div className={styles.sectionTitle}>📝 Observaciones (Opcional)</div>
              <textarea
                className={styles.textareaField}
                placeholder="¿Algo que reportar? Ej: Faltó jabón en el baño de empleados..."
              />

              <div className={styles.sectionTitle}>Tareas Especiales Completadas</div>
              <div className={styles.checkboxList}>
                <div className={styles.checkboxItem}>
                  <div className={styles.customCheckbox}>✓</div>
                  <span>Limpiar campana extractora</span>
                </div>
                <div className={styles.checkboxItem}>
                  <div className={styles.customCheckbox}>✓</div>
                  <span>Desinfectar área de cajas</span>
                </div>
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryTitle}>Resumen del Turno</div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>⏱️ Duración total</span>
                  <span className={styles.summaryValue}>4h 15min</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>📸 Fotos adjuntas</span>
                  <span className={styles.summaryValue}>6 imágenes</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>📍 Ubicación</span>
                  <span className={styles.summaryValue}>✅ Verificada</span>
                </div>
              </div>
            </div>

            <div className={styles.bottomAction}>
              <button className={styles.btnFull}>✓ FINALIZAR TURNO</button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.phoneContainer}>
        <div className={styles.phoneLabel}>PANTALLA 7: ÉXITO</div>
        <div className={styles.phone}>
          <div className={`${styles.screen} ${styles.successScreen}`}>
            <div className={styles.successIcon}>✓</div>

            <div className={styles.successTitle}>
              ¡TURNO
              <br />
              COMPLETADO!
            </div>

            <div className={styles.successDetails}>
              <strong>"El Buen Sabor"</strong>
              <br />
              08:00 - 12:15
              <br />
              4h 15min trabajadas
            </div>

            <div className={styles.savingIndicator}>
              <div className={styles.savingText}>💾 Guardando datos...</div>
              <div className={styles.progressLine}>
                <div className={styles.progressFill} />
              </div>
            </div>

            <button className={styles.btnWhite}>📋 VER MIS TURNOS</button>
            <button className={styles.btnTransparent}>🏠 Volver al inicio</button>
          </div>
        </div>
      </div>
    </div>
  )
}
