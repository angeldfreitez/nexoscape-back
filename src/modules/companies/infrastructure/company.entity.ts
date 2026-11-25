import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'companies' })
export class CompanyEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'initial_admin_email', type: 'varchar', length: 254 })
  initialAdminEmail!: string;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt!: Date | null;
}
