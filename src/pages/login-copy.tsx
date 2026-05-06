import { useForm } from "react-hook-form";

type FormData = {
  login: string;
  password: string;
};

export default function Login() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>();

  const onSubmit = (data: FormData) => {
    console.log(data);
  };

  return (
    <div>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div>logo-link to description app</div>
        <h2>Войти в аккаунт</h2>
        <div>
          <div>
            <div>
              <div>
                <label htmlFor="login">Логин или Email</label>
                {errors.login && <p>{errors.login.message}</p>}
              </div>
              <div>
                <input {...register("login")} id="login" />
              </div>
            </div>
          </div>
        </div>
        <div>
          <div>
            <div>
              <div>
                <label htmlFor="password">Пароль</label>
              </div>
              <div>
                <input type="text" id="password" {...register("password")} />
              </div>
            </div>
          </div>
          <button>Авторизоваться</button>
          <div>
            <span>или</span>
          </div>
          <button>Войти с помощью Google</button>
          <div>
            <a>Забыли пароль?</a>
          </div>
          <span>
            Нет аккаунта? <a>Зарегистрируйтесь</a>
          </span>
          <div>
            <div>RO App © 2012-2026</div>
            <a>support</a>
          </div>
        </div>
      </form>
    </div>
  );
}
