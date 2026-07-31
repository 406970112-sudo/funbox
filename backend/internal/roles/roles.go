package roles

type Role string

const (
	Normal Role = "normal"
	VIP    Role = "vip"
	SVIP   Role = "svip"
	Admin  Role = "admin"
)

var All = []Role{Normal, VIP, SVIP, Admin}

func IsValid(role Role) bool {
	for _, candidate := range All {
		if role == candidate {
			return true
		}
	}
	return false
}
